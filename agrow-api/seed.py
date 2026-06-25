from app.database.session import SessionLocal
from app.models.user import User
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')

def seed_user():
    db = SessionLocal()

    existing_user = db.query(User).filter(User.email == 'test@agrow.com').first()
    if existing_user:
        print('User already exist')
        db.close()
        return
    
    test_user = User(
        full_name='Steve Joseph',
        email='sj@s.com',
        hashed_password=pwd_context.hash('123abc'),
        role='Agronomist',
        is_active=True
    )

    db.add(test_user)
    db.commit()
    print('successfully seeded into agrow_db')
    db.close()
if __name__ == '__main__':
    seed_user()