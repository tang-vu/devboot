import { useEffect, useRef, useState } from 'react';
import { Settings as SettingsType } from '../types';
import './Settings.css';

interface SettingsProps {
    settings: SettingsType | null;
    loading: boolean;
    loadError: string | null;
    saving: boolean;
    saveError: string | null;
    startupError: string | null;
    onRetryLoad: () => void;
    onSave: (settings: SettingsType) => Promise<void>;
    onClose: () => void;
}

const WALLET_ADDRESS = '0x051BF9b67aC43BbB461A33E13c21218f304E31BB';

export function Settings({
    settings, loading, loadError, saving, saveError, startupError, onRetryLoad, onSave, onClose,
}: SettingsProps) {
    const [localSettings, setLocalSettings] = useState<SettingsType | null>(settings);
    const [copied, setCopied] = useState(false);
    const lifetimeRef = useRef<object | null>(null);
    const submittingRef = useRef(false);

    useEffect(() => {
        const lifetime = {};
        lifetimeRef.current = lifetime;
        return () => { if (lifetimeRef.current === lifetime) lifetimeRef.current = null; };
    }, []);

    // Initialize only after a successful load. Later results cannot replace a draft.
    useEffect(() => { setLocalSettings(current => current ?? settings); }, [settings]);

    const handleToggle = (key: 'auto_start_with_windows' | 'minimize_to_tray' | 'show_notifications') => {
        if (loading || saving || submittingRef.current) return;
        setLocalSettings(prev => prev && ({ ...prev, [key]: !prev[key] }));
    };

    const handleSave = async () => {
        if (!localSettings || loading || saving || submittingRef.current) return;
        const lifetime = lifetimeRef.current;
        submittingRef.current = true;
        try {
            await onSave({ ...localSettings });
            if (lifetimeRef.current === lifetime) onClose();
        } catch {
            // The shared save error also remains visible if this dialog was reopened.
        } finally {
            submittingRef.current = false;
        }
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
            <div className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 id="settings-title">Settings</h2>
                    <button className="close-btn" aria-label="Close Settings" onClick={onClose}>x</button>
                </div>

                <div className="modal-body">
                    {loading && <p role="status">Loading settings...</p>}
                    {loadError && <div className="settings-notice" role="alert">
                        <p>{loadError}</p>
                        <button className="btn btn-secondary" onClick={onRetryLoad} disabled={loading}>Retry loading settings</button>
                    </div>}
                    {saveError && <p className="settings-notice" role="alert">{saveError}</p>}
                    {startupError && <p className="settings-notice" role="alert">{startupError}</p>}
                    {saving && <p role="status">Saving settings... Closing this window does not cancel the save.</p>}
                    {localSettings && !loading && !loadError && <fieldset className="settings-preferences" disabled={saving}>
                    <div className="settings-section">
                        <h3>Startup</h3>
                        <label className="toggle-item">
                            <span className="toggle-label">
                                <span className="toggle-icon">{"[>]"}</span>
                                Auto-start with Windows
                            </span>
                            <button type="button" role="switch" aria-label="Auto-start with Windows" aria-checked={localSettings.auto_start_with_windows}
                                className={`toggle ${localSettings.auto_start_with_windows ? 'active' : ''}`}
                                onClick={() => handleToggle('auto_start_with_windows')}
                            >
                                <span className="toggle-knob" />
                            </button>
                        </label>

                        <label className="toggle-item">
                            <span className="toggle-label">
                                <span className="toggle-icon">[_]</span>
                                Minimize to system tray
                            </span>
                            <button type="button" role="switch" aria-label="Minimize to system tray" aria-checked={localSettings.minimize_to_tray}
                                className={`toggle ${localSettings.minimize_to_tray ? 'active' : ''}`}
                                onClick={() => handleToggle('minimize_to_tray')}
                            >
                                <span className="toggle-knob" />
                            </button>
                        </label>
                    </div>

                    <div className="settings-section">
                        <h3>Notifications</h3>
                        <label className="toggle-item">
                            <span className="toggle-label">
                                <span className="toggle-icon">[!]</span>
                                Show notifications
                            </span>
                            <button type="button" role="switch" aria-label="Show notifications" aria-checked={localSettings.show_notifications}
                                className={`toggle ${localSettings.show_notifications ? 'active' : ''}`}
                                onClick={() => handleToggle('show_notifications')}
                            >
                                <span className="toggle-knob" />
                            </button>
                        </label>
                    </div>

                    <div className="settings-section">
                        <h3>Appearance</h3>
                        <div className="theme-selector">
                            <button
                                className={`theme-btn ${localSettings.theme === 'dark' ? 'active' : ''}`}
                                onClick={() => setLocalSettings(prev => prev && ({ ...prev, theme: 'dark' }))}
                            >
                                Dark
                            </button>
                            <button
                                className={`theme-btn ${localSettings.theme === 'light' ? 'active' : ''}`}
                                onClick={() => setLocalSettings(prev => prev && ({ ...prev, theme: 'light' }))}
                            >
                                Light
                            </button>
                        </div>
                    </div>

                    </fieldset>}

                    <div className="settings-section support-section">
                        <h3>Support & About</h3>
                        <div className="about-info">
                            <p className="app-name">DevBoot v1.0.1</p>
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
                    <button className="btn btn-primary" onClick={handleSave} disabled={!localSettings || loading || !!loadError || saving}>
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
}
