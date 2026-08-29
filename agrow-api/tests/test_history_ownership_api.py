import uuid
import unittest
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.endpoints import history
from app.api.endpoints.auth import get_current_user
from app.database.session import engine, get_db
from app.models.analysis_history import AnalysisHistory
from app.models.user import User


class HistoryOwnershipApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.connection = engine.connect()
        cls.transaction = cls.connection.begin()
        setup_session = Session(bind=cls.connection)
        unique = uuid.uuid4().hex
        users = [
            User(
                full_name="History Owner A",
                email=f"history-owner-a-{unique}@example.test",
                hashed_password="not-used-by-dependency-override",
                role="Agronomist",
                is_active=True,
            ),
            User(
                full_name="History Owner B",
                email=f"history-owner-b-{unique}@example.test",
                hashed_password="not-used-by-dependency-override",
                role="Agronomist",
                is_active=True,
            ),
        ]
        setup_session.add_all(users)
        setup_session.flush()
        cls.user_a_id, cls.user_b_id = users[0].id, users[1].id
        setup_session.close()

        cls.app = FastAPI()
        cls.app.include_router(history.router, prefix="/api/history")

        def test_db():
            session = Session(bind=cls.connection)
            try:
                yield session
            finally:
                session.close()

        cls.app.dependency_overrides[get_db] = test_db
        cls.client = TestClient(cls.app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        cls.app.dependency_overrides.clear()
        cls.transaction.rollback()
        cls.connection.close()

    def authenticate_as(self, user_id):
        self.app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=user_id)

    def create_history(self, user_id, *, name=None, extra_payload=None):
        self.authenticate_as(user_id)
        marker = uuid.uuid4().hex
        payload = {
            "name": name or f"history-{marker}",
            "boundary": [
                [116.0000, 5.0000],
                [116.0010, 5.0000],
                [116.0010, 5.0010],
                [116.0000, 5.0000],
            ],
            "selected_crop": "Rice",
            "prediction_result": {"allowed": True},
        }
        if extra_payload:
            payload.update(extra_payload)
        response = self.client.post(
            "/api/history",
            json=payload,
            headers={"Idempotency-Key": f"test-{marker}"},
        )
        return response

    def test_create_uses_authenticated_postgresql_user_id(self):
        response = self.create_history(self.user_a_id)
        self.assertEqual(response.status_code, 201, response.text)

        session = Session(bind=self.connection)
        try:
            record = session.get(AnalysisHistory, uuid.UUID(response.json()["id"]))
            self.assertIsNotNone(record)
            self.assertEqual(record.user_id, self.user_a_id)
        finally:
            session.close()

    def test_each_user_only_lists_their_own_history(self):
        marker = uuid.uuid4().hex
        response_a = self.create_history(self.user_a_id, name=f"{marker}-a")
        response_b = self.create_history(self.user_b_id, name=f"{marker}-b")
        self.assertEqual(response_a.status_code, 201, response_a.text)
        self.assertEqual(response_b.status_code, 201, response_b.text)

        self.authenticate_as(self.user_a_id)
        list_a = self.client.get("/api/history", params={"search": marker})
        self.assertEqual([item["name"] for item in list_a.json()["items"]], [f"{marker}-a"])

        self.authenticate_as(self.user_b_id)
        list_b = self.client.get("/api/history", params={"search": marker})
        self.assertEqual([item["name"] for item in list_b.json()["items"]], [f"{marker}-b"])

    def test_foreign_record_is_404_for_read_update_delete_and_restore(self):
        created = self.create_history(self.user_b_id)
        self.assertEqual(created.status_code, 201, created.text)
        history_id = created.json()["id"]
        self.authenticate_as(self.user_a_id)

        attempts = [
            self.client.get(f"/api/history/{history_id}"),
            self.client.patch(f"/api/history/{history_id}", json={"name": "Not yours"}),
            self.client.delete(f"/api/history/{history_id}"),
            self.client.post(f"/api/history/{history_id}/restore"),
        ]
        for response in attempts:
            self.assertEqual(response.status_code, 404, response.text)

        self.authenticate_as(self.user_b_id)
        self.assertEqual(self.client.get(f"/api/history/{history_id}").status_code, 200)

    def test_unauthenticated_history_request_is_401(self):
        self.app.dependency_overrides.pop(get_current_user, None)

        response = self.client.get("/api/history")

        self.assertEqual(response.status_code, 401)

    def test_frontend_user_id_cannot_override_authenticated_owner(self):
        response = self.create_history(
            self.user_a_id,
            extra_payload={"user_id": self.user_b_id},
        )

        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
