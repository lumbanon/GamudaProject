import { useState,useEffect } from 'react';
import './Setting.css';

export default function ProfileCard() {
  return (
    <div className="settings-card profile-card">
      <div className="profile-header">
        <div className="profile-avatar">👤</div>
        <div>
          <h2 className="profile-name">Steve Nico</h2>
          <p className="profile-role">Agronomists & Field Researcher</p>
          <p className="profile-email">stevenico@email.com</p>
        </div>
      </div>

      <hr className="profile-divider" />

      <button className="btn-edit-profile">
        Edit Profile
      </button>
    </div>
  );
}