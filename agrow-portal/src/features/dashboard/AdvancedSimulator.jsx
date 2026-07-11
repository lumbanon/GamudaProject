export default function AdvancedSimulator({
    selectedDistrict,
    showModeling,
    setShowModeling,
    simulationParams,
    handleParamChange,
    resetParams,
    matrixData
}) {
    return (
        <div className='card'>
            <div className='sandbox-header-container'>
                <div className='d-flex justify-content-between align-items-center'>
                    <h3 className='section-title m-0'>Advanced Simulator</h3>
                    <div className='custom-toggle-container'>
                        <input
                            type='checkbox'
                            id='customParamToggle'
                            className='custom-toggle-input'
                            checked={showModeling}
                            onChange={(e) => setShowModeling(e.target.checked)}
                        />
                        <label htmlFor='customParamToggle' className='custom-toggle-label'>
                            <span className='custom-toggle-thumb'></span>
                        </label>
                    </div>
                </div>
                <p className='section-description mt-2 mb-0'>
                    Enable to manually simulate chemical soil adjustments, land-terracing, or local micro-climate offsets.
                </p>
            </div>

            {!showModeling ? (
                <div className='automated-profile-section mt-4'>
                    <h5 className='section-subtitle subtitle-automated'>
                        AUTOMATED SITE PROFILE for {selectedDistrict || 'Selected Region'}
                    </h5>
                    <div className='profile-grid'>
                        <div className='profile-box'>
                            <span className='profile-label'>ELEVATION</span>
                            <span className='profile-value'>{matrixData ? `${matrixData.elev}m` : '—'}</span>
                        </div>
                        <div className='profile-box'>
                            <span className='profile-label'>TERRAIN SLOPE</span>
                            <span className='profile-value'>{matrixData ? `${matrixData.slope}%` : '—'}</span>
                        </div>
                        <div className='profile-box'>
                            <span className='profile-label'>SOIL ACIDITY</span>
                            <span className='profile-value'>{matrixData ? `${matrixData.ph} pH` : '—'}</span>
                        </div>
                        <div className='profile-box'>
                            <span className='profile-label'>SOIL DEPTH</span>
                            <span className='profile-value'>{matrixData ? `${matrixData.depth}cm` : '—'}</span>
                        </div>
                        <div className='profile-box'>
                            <span className='profile-label'>ANNUAL RAINFALL</span>
                            <span className='profile-value'>
                                {matrixData ? `${Number(matrixData.rain).toLocaleString()}mm` : '—'}
                            </span>
                        </div>
                        <div className='profile-box'>
                            <span className='profile-label'>SOLAR INTENSITY</span>
                            <span className='profile-value'>{matrixData ? `${matrixData.solar}` : '—'}</span>
                        </div>
                    </div>
                </div>
            ) : (
                <div className='interactive-modulators-section mt-4'>
                    <h5 className='section-subtitle subtitle-interactive'>INTERACTIVE MODULATORS</h5>

                    <div className='simulator-slider-group'>
                        <div className='slider-header'>
                            <span className='slider-title'>Elevation Baseline:</span>
                            <span className='slider-current-value'>{simulationParams.elev}m</span>
                        </div>
                        <input
                            type='range' min='0' max='3000' step='10'
                            value={simulationParams.elev}
                            onChange={(e) => handleParamChange('elev', parseInt(e.target.value, 10))}
                            className='sandbox-range-input'
                        />
                    </div>

                    <div className='simulator-slider-group'>
                        <div className='slider-header'>
                            <span className='slider-title'>Slope Angle:</span>
                            <span className='slider-current-value'>{simulationParams.slope}%</span>
                        </div>
                        <input
                            type='range' min='0' max='100' step='1'
                            value={simulationParams.slope}
                            onChange={(e) => handleParamChange('slope', parseInt(e.target.value, 10))}
                            className='sandbox-range-input'
                        />
                    </div>

                    <div className='simulator-slider-group'>
                        <div className='slider-header'>
                            <span className='slider-title'>Soil Chemistry (pH):</span>
                            <span className='slider-current-value'>{simulationParams.ph} pH</span>
                        </div>
                        <input
                            type='range' min='3.5' max='9.0' step='0.1'
                            value={simulationParams.ph}
                            onChange={(e) => handleParamChange('ph', parseFloat(e.target.value))}
                            className='sandbox-range-input'
                        />
                    </div>

                    <div className='simulator-slider-group'>
                        <div className='slider-header'>
                            <span className='slider-title'>Soil Depth:</span>
                            <span className='slider-current-value'>{simulationParams.depth} cm</span>
                        </div>
                        <input
                            type='range' min='0' max='200' step='5'
                            value={simulationParams.depth}
                            onChange={(e) => handleParamChange('depth', parseInt(e.target.value, 10))}
                            className='sandbox-range-input'
                        />
                    </div>

                    <div className='simulator-slider-group'>
                        <div className='slider-header'>
                            <span className='slider-title'>Annual Rainfall:</span>
                            <span className='slider-current-value'>
                                {Number(simulationParams.rain).toLocaleString()} mm
                            </span>
                        </div>
                        <input
                            type='range' min='500' max='5000' step='50'
                            value={simulationParams.rain}
                            onChange={(e) => handleParamChange('rain', parseInt(e.target.value, 10))}
                            className='sandbox-range-input'
                        />
                    </div>

                    <div className='simulator-slider-group'>
                        <div className='slider-header'>
                            <span className='slider-title'>Solar Intensity:</span>
                            <span className='slider-current-value'>{simulationParams.solar}</span>
                        </div>
                        <input
                            type='range' min='0' max='50' step='1'
                            value={simulationParams.solar}
                            onChange={(e) => handleParamChange('solar', parseInt(e.target.value, 10))}
                            className='sandbox-range-input'
                        />
                    </div>

                    <div className='modeling-actions mt-4 d-flex gap-2'>
                        <button onClick={resetParams} className='btn-reset-simulation'>
                            {matrixData ? '[ Reset to Baseline ]' : '[ Reset ]'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}