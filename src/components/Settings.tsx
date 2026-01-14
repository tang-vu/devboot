import { useState } from 'react';
import { Settings as SettingsType } from '../types';
import './Settings.css';

interface SettingsProps {
    settings: SettingsType;
    onSave: (settings: SettingsType) => void;
    onClose: () => void;
}

export function Settings({ settings, onSave, onClose }: SettingsProps) {
    const [localSettings, setLocalSettings] = useState<SettingsType>(settings);

    const handleToggle = (key: keyof SettingsType) => {
        setLocalSettings(prev => ({
            ...prev,
            [key]: !prev[key],
        }));
    };

    const handleSave = () => {
        onSave(localSettings);
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal settings-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>⚙ Settings</h2>
                    <button className="close-btn" onClick={onClose}>✕</button>
                </div>

                <div className="modal-body">
                    <div className="settings-section">
                        <h3>Startup</h3>
                        <label className="toggle-item">
                            <span className="toggle-label">
                                <span className="toggle-icon">🚀</span>
                                Auto-start with Windows
                            </span>
                            <div
                                className={`toggle ${localSettings.auto_start_with_windows ? 'active' : ''}`}
                                onClick={() => handleToggle('auto_start_with_windows')}
                            >
                                <div className="toggle-knob" />
                            </div>
                        </label>

                        <label className="toggle-item">
                            <span className="toggle-label">
                                <span className="toggle-icon">📥</span>
                                Minimize to system tray
                            </span>
                            <div
                                className={`toggle ${localSettings.minimize_to_tray ? 'active' : ''}`}
                                onClick={() => handleToggle('minimize_to_tray')}
                            >
                                <div className="toggle-knob" />
                            </div>
                        </label>
                    </div>

                    <div className="settings-section">
                        <h3>Notifications</h3>
                        <label className="toggle-item">
                            <span className="toggle-label">
                                <span className="toggle-icon">🔔</span>
                                Show notifications
                            </span>
                            <div
                                className={`toggle ${localSettings.show_notifications ? 'active' : ''}`}
                                onClick={() => handleToggle('show_notifications')}
                            >
                                <div className="toggle-knob" />
                            </div>
                        </label>
                    </div>

                    <div className="settings-section">
                        <h3>Appearance</h3>
                        <div className="theme-selector">
                            <button
                                className={`theme-btn ${localSettings.theme === 'dark' ? 'active' : ''}`}
                                onClick={() => setLocalSettings(prev => ({ ...prev, theme: 'dark' }))}
                            >
                                🌙 Dark
                            </button>
                            <button
                                className={`theme-btn ${localSettings.theme === 'light' ? 'active' : ''}`}
                                onClick={() => setLocalSettings(prev => ({ ...prev, theme: 'light' }))}
                            >
                                ☀️ Light
                            </button>
                        </div>
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>
                        Cancel
                    </button>
                    <button className="btn btn-primary" onClick={handleSave}>
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
}
