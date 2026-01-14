import { useState } from 'react';
import { Settings as SettingsType } from '../types';
import './Settings.css';

interface SettingsProps {
    settings: SettingsType;
    onSave: (settings: SettingsType) => void;
    onClose: () => void;
}

const WALLET_ADDRESS = '0x051BF9b67aC43BbB461A33E13c21218f304E31BB';

export function Settings({ settings, onSave, onClose }: SettingsProps) {
    const [localSettings, setLocalSettings] = useState<SettingsType>(settings);
    const [copied, setCopied] = useState(false);

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

    const copyWallet = () => {
        navigator.clipboard.writeText(WALLET_ADDRESS);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const openLink = (url: string) => {
        window.open(url, '_blank');
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal settings-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Settings</h2>
                    <button className="close-btn" onClick={onClose}>x</button>
                </div>

                <div className="modal-body">
                    <div className="settings-section">
                        <h3>Startup</h3>
                        <label className="toggle-item">
                            <span className="toggle-label">
                                <span className="toggle-icon">{"[>]"}</span>
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
                                <span className="toggle-icon">[_]</span>
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
                                <span className="toggle-icon">[!]</span>
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
                                Dark
                            </button>
                            <button
                                className={`theme-btn ${localSettings.theme === 'light' ? 'active' : ''}`}
                                onClick={() => setLocalSettings(prev => ({ ...prev, theme: 'light' }))}
                            >
                                Light
                            </button>
                        </div>
                    </div>

                    <div className="settings-section support-section">
                        <h3>Support & About</h3>
                        <div className="about-info">
                            <p className="app-name">DevBoot v0.1.1</p>
                            <p className="author">Made by <strong>tang-vu</strong></p>
                            <p className="description">GitBash Management App for Windows</p>
                        </div>

                        <div className="support-actions">
                            <button 
                                className="support-btn github"
                                onClick={() => openLink('https://github.com/tang-vu/devboot')}
                            >
                                [*] Star on GitHub
                            </button>
                        </div>

                        <div className="donate-section">
                            <p className="donate-label">Buy me a coffee (Crypto):</p>
                            <div className="wallet-box" onClick={copyWallet}>
                                <code>{WALLET_ADDRESS}</code>
                                <span className="copy-hint">{copied ? 'Copied!' : 'Click to copy'}</span>
                            </div>
                            <div className="chain-links">
                                <button onClick={() => openLink('https://bscscan.com/address/' + WALLET_ADDRESS)}>
                                    BSC
                                </button>
                                <button onClick={() => openLink('https://polygonscan.com/address/' + WALLET_ADDRESS)}>
                                    Polygon
                                </button>
                                <button onClick={() => openLink('https://arbiscan.io/address/' + WALLET_ADDRESS)}>
                                    Arbitrum
                                </button>
                            </div>
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
