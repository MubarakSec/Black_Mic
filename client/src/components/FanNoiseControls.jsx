import { useEffect, useState } from 'react';
import { MAX_NOISE_FLOOR_DB, MIN_NOISE_FLOOR_DB } from '../constants';

export default function FanNoiseControls({
  isFanProfile,
  isCalibrating,
  noiseFloorDb,
  noiseReductionActive,
  onCalibrateNoise,
  onToggleNoiseReduction,
  onSetNoiseFloor,
}) {
  const [floorInput, setFloorInput] = useState('');

  useEffect(() => {
    if (noiseFloorDb === null) return;
    setFloorInput(String(noiseFloorDb));
  }, [noiseFloorDb]);

  const handleFloorBlur = () => {
    const parsed = parseFloat(floorInput);
    if (!Number.isFinite(parsed) || !onSetNoiseFloor) {
      setFloorInput(String(noiseFloorDb));
      return;
    }
    onSetNoiseFloor(parsed);
  };

  const handleFloorKeyDown = (event) => {
    if (event.key !== 'Enter') return;
    event.target.blur();
  };

  const reductionStatus = isFanProfile
    ? `Suppressing stationary noise below ${noiseFloorDb} dBFS`
    : 'Saved calibration applies only in FAN. RAW stays untouched.';

  return (
    <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '0.75rem' }}>
      <div style={{ fontSize: '0.72rem', opacity: 0.45, marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        Fan Noise Reduction
      </div>
      {noiseFloorDb === null ? (
        <button
          className={`btn-control ${isCalibrating ? 'is-warning-active' : ''}`}
          onClick={onCalibrateNoise}
          disabled={isCalibrating}
          style={{ width: '100%', padding: '0.5rem 0' }}
        >
          {isCalibrating ? '🔇 Calibrating... Stay silent' : '🎯 Calibrate Fan Noise'}
        </button>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', fontSize: '0.8rem' }}>
          <span style={{ opacity: 0.6 }}>Floor:</span>
          <input
            type="number"
            value={floorInput}
            onChange={(event) => setFloorInput(event.target.value)}
            onBlur={handleFloorBlur}
            onKeyDown={handleFloorKeyDown}
            step="0.1"
            min={MIN_NOISE_FLOOR_DB}
            max={MAX_NOISE_FLOOR_DB}
            style={{
              width: '70px',
              padding: '0.2rem 0.3rem',
              borderRadius: '4px',
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(0,0,0,0.4)',
              color: 'var(--accent-1)',
              fontFamily: 'JetBrains Mono',
              fontSize: '0.8rem',
              textAlign: 'center',
              outline: 'none',
            }}
          />
          <span style={{ opacity: 0.5, fontSize: '0.72rem' }}>dBFS</span>
          <button
            className={`btn-control ${noiseReductionActive ? 'is-sender-active' : ''}`}
            onClick={onToggleNoiseReduction}
            style={{ padding: '0.3rem 0.6rem' }}
          >
            {noiseReductionActive ? 'ON' : 'OFF'}
          </button>
          <button
            className="btn-control"
            onClick={onCalibrateNoise}
            disabled={isCalibrating}
            style={{ padding: '0.3rem 0.6rem' }}
          >
            {isCalibrating ? 'Calibrating…' : 'Recal'}
          </button>
        </div>
      )}
      {noiseFloorDb !== null && noiseReductionActive && (
        <div style={{ fontSize: '0.7rem', opacity: 0.45, marginTop: '0.3rem', textAlign: 'center' }}>
          {reductionStatus}
        </div>
      )}
    </div>
  );
}
