import { useState,useEffect } from 'react';
import './Setting.css';

// FUNCTION : Main Settings Panel Component

export default function SettingsPanel() {
const [dataPrefActive, setDataPrefActive] = useState(false);

const [selectedLayer, setSelectedLayer] = useState('topo');
const [boundariesEnabled, setBoundariesEnabled] = useState(true);

const [CropOption,setCropOption]=useState(['Cocoa']);
const [reportOptions,setReportoptions]=useState(['Weekly']);
const [selectedCrop, setSelectedCrop] = useState('Cocoa');
const [selectedReport, setSelectedReport] = useState('Weekly');

// useEffect(()=>{},[]);

  return (
    <div className="settings-card panel-card">
      
      {/* Section A: Data Preferences */}

      <div className="settings-section">
        <div className="section-header">
          <h3 className="section-title">Data Preferences</h3>
          <label className='toggle-switch'>
            <input type="checkbox"
                    checked ={dataPrefActive}
                    onChange={(e)=> setDataPrefActive(e.target.checked)} />
                  <span className='toggle-slider'></span>
          </label>
        </div>
        <p className="section-description">Auto-update regional datasets</p>
        
        <div className="inputs-row">
          <div className="input-field-group">
            <label className="input-label">Crop Focus</label>
            <select className="custom-select"
                    value ={selectedCrop}
                    onChange={(e)=> setSelectedCrop(e.target.value)}
            >
              {CropOption.map((crop,index)=>
              <option key= {index} value ={crop}>{crop}</option>
              )}
              </select>
          </div>
          <div className="input-field-group">
            <label className="input-label">Reports</label>
            <select className="custom-select"
                    value ={selectedReport}
                    onChange={(e)=> setSelectedReport(e.target.value)}
            >
              {reportOptions.map((report,index)=>
              <option key ={index} value ={report}>{report}</option>
              )}
              </select>
          </div>
        </div>
      </div>

      {/* Section B: District Boundaries */}

      <div className="settings-section">
        <div className="section-header">
          <h3 className="section-title">District Boundaries</h3>
         <label className='toggle-switch'>
           <input type="checkbox"
         checked ={boundariesEnabled}
         onChange={(e)=> setBoundariesEnabled(e.target.checked)} />
         <span className='toggle-slider'></span>
          </label> 
         
        </div>
        <p className="section-description" style={{ marginBottom: "12px" }}>District Boundaries</p>
        
        <div className="sub-options-container">
          <span 
            onClick={() => setSelectedLayer('topo')} 
            style={{ cursor: 'pointer', userSelect: 'none' }}
          >
            {selectedLayer === 'topo' ? '◆' : '◇'}{' '}
            <span className={selectedLayer === 'topo' ? 'option-active' : 'option-inactive'}>
              Topographic
            </span>
          </span>
          
          <span 
            onClick={() => setSelectedLayer('land')} 
            style={{ cursor: 'pointer', userSelect: 'none' }}
          >
            {selectedLayer === 'land' ? '◆' : '◇'}{' '}
            <span className={selectedLayer === 'land' ? 'option-active' : 'option-inactive'}>
              Land Use
            </span>
          </span>
        </div>
      </div>

      {/* Section C: Notifications */}

      <div>
        <h3 className="section-title"> Notifications</h3>
        <div className="checkbox-group">
          <label className="checkbox-label">
            <input type="checkbox" defaultChecked className="custom-checkbox" /> Prediction Alerts
          </label>
          <label className="checkbox-label">
            <input type="checkbox" defaultChecked className="custom-checkbox" /> Export Status
          </label>
        </div>
      </div>

    </div>
  );
}