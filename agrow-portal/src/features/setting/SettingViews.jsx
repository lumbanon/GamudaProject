import { useState, useEffect } from "react";
import ProfileCard from "./UserprofileCard";
import SettingsPanel from "./SettingPanel";
import './Setting.css';

export default function SettingViews() {

    return (
        <div className="settings-container">
            <div className="row setting-title-row">
                <div className="col-12">
                    {/* <h1 className= "settings-title">Settings</h1> */}
                </div>
            </div>

            <div className="row">
                <div className="col-4">
                    <ProfileCard />
                </div>
                <div className="col-1"></div>

                <div className="col-6">
                    <SettingsPanel />
                    <div />
                </div>
            </div>
        </div>
    )
}