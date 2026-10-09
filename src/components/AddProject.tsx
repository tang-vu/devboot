import { useState, DragEvent, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Project, ProjectOptions, CommandSuggestion, DetectedProjectInfo } from '../types';
import { projectTemplates } from '../data/templates';
import './AddProject.css';

interface AddProjectProps {
    project?: Project | null;
    onSave: (name: string, path: string, commands: string[], options: ProjectOptions, envVars?: Record<string, string>) => void | Promise<void>;
    onClose: () => void;
}

type DetectionPhase = 'idle' | 'picking' | 'pending' | 'error';

export function AddProject({ project, onSave, onClose }: AddProjectProps) {
    const [name, setName] = useState(project?.name || '');
    const [path, setPath] = useState(project?.path || '');
    const [commands, setCommands] = useState(project?.commands.join('\n') || '');
    const [projectType, setProjectType] = useState<string>('');
    const [framework, setFramework] = useState<string | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [detectionPhase, setDetectionPhase] = useState<DetectionPhase>('idle');
    const [detectionError, setDetectionError] = useState('');
    const [pickerError, setPickerError] = useState('');
    const [activeTab, setActiveTab] = useState<'commands' | 'env' | 'options'>('commands');
    const [isSaving, setIsSaving] = useState(false);
    const [environmentError, setEnvironmentError] = useState('');
    const savingRef = useRef(false);
    const mountedRef = useRef(false);
    const detectionGeneration = useRef(0);
    const detectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const phaseRef = useRef<DetectionPhase>('idle');
    const pathRef = useRef(path);
    const nameEdited = useRef(false);
    const commandsEdited = useRef(false);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            detectionGeneration.current += 1;
            if (detectionTimer.current !== null) clearTimeout(detectionTimer.current);
        };
    }, []);

    // Command suggestions
    const [suggestions, setSuggestions] = useState<CommandSuggestion[]>([]);
    const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());

    // Environment variables
    const [envVars, setEnvVars] = useState<Array<{key: string, value: string}>>(
        project?.env_vars
            ? Object.entries(project.env_vars).map(([key, value]) => ({ key, value }))
            : []
    );

    // Options
    const [autoStart, setAutoStart] = useState(project?.auto_start ?? true);
    const [restartOnCrash, setRestartOnCrash] = useState(project?.restart_on_crash ?? true);

    const changeDetectionPhase = (phase: DetectionPhase) => {
        phaseRef.current = phase;
        setDetectionPhase(phase);
    };

    const invalidateDetection = () => {
        if (detectionTimer.current !== null) clearTimeout(detectionTimer.current);
        detectionTimer.current = null;
        return ++detectionGeneration.current;
    };

    const ownsDetection = (generation: number) => mountedRef.current
        && !savingRef.current && generation === detectionGeneration.current;

    const detectProject = async (folderPath: string, generation: number) => {
        if (!ownsDetection(generation)) return;
        try {
            const detected = await invoke<DetectedProjectInfo>('detect_project_from_path', {
                path: folderPath
            });

            if (!ownsDetection(generation)) return;
            if (!nameEdited.current) setName(detected.name);
            setProjectType(detected.project_type);
            setFramework(detected.framework);
            setSuggestions(detected.suggestions);

            // Automatic suggestions never replace deliberate edits in this form.
            const recommendedIndexes = new Set<number>();
            detected.suggestions.forEach((s, index) => {
                if (s.is_recommended && !commandsEdited.current) {
                    recommendedIndexes.add(index);
                }
            });
            setSelectedSuggestions(recommendedIndexes);
            if (!commandsEdited.current) {
                setCommands(detected.suggestions
                    .filter((_, index) => recommendedIndexes.has(index))
                    .map(s => s.command).join('\n'));
            }
            changeDetectionPhase('idle');
        } catch (error) {
            if (!ownsDetection(generation)) return;
            setDetectionError(`Project detection failed: ${error}`);
            changeDetectionPhase('error');
        }
    };

    const choosePath = (folderPath: string, debounce = false) => {
        if (savingRef.current) return;
        const generation = invalidateDetection();
        pathRef.current = folderPath;
        setPath(folderPath);
        setPickerError('');
        setDetectionError('');
        setProjectType('');
        setFramework(null);
        setSuggestions([]);
        setSelectedSuggestions(new Set());
        changeDetectionPhase(folderPath.trim() ? 'pending' : 'idle');
        if (!folderPath.trim()) return;
        if (debounce) {
            detectionTimer.current = setTimeout(() => {
                detectionTimer.current = null;
                void detectProject(folderPath, generation);
            }, 500);
        } else {
            void detectProject(folderPath, generation);
        }
    };

    const closeForm = () => {
        invalidateDetection();
        onClose();
    };

    // Open folder picker dialog
    const handleBrowseFolder = async () => {
        if (savingRef.current || phaseRef.current === 'picking') return;
        const previousPhase = phaseRef.current;
        const generation = invalidateDetection();
        setPickerError('');
        changeDetectionPhase('picking');
        const restoreDraft = () => {
            // Cancelling the picker resumes an interrupted path lookup, if any.
            if (previousPhase === 'pending') choosePath(pathRef.current);
            else changeDetectionPhase(previousPhase);
        };
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: 'Select Project Folder',
            });

            if (!ownsDetection(generation)) return;
            if (selected && typeof selected === 'string') choosePath(selected);
            else restoreDraft();
        } catch (error) {
            if (!ownsDetection(generation)) return;
            restoreDraft();
            setPickerError(`Could not open the folder picker. Type a path or try Browse again. ${error}`);
        }
    };

    const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    };

    const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    };

    const handleDrop = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        if (savingRef.current) return;

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            let folderPath = (file as any).path || file.name;

            if (folderPath.includes('.')) {
                folderPath = folderPath.substring(0, folderPath.lastIndexOf('\\'));
            }

            choosePath(folderPath);
        }
    };

    // Toggle suggestion selection
    const toggleSuggestion = (index: number) => {
        const newSelected = new Set(selectedSuggestions);
        if (newSelected.has(index)) {
            newSelected.delete(index);
        } else {
            newSelected.add(index);
        }
        commandsEdited.current = true;
        setSelectedSuggestions(newSelected);
        setCommands(suggestions.filter((_, item) => newSelected.has(item)).map(s => s.command).join('\n'));
    };

    // Apply template
    const handleTemplateChange = (templateId: string) => {
        const template = projectTemplates.find(t => t.id === templateId);
        if (template) {
            commandsEdited.current = true;
            setSelectedSuggestions(new Set());
            setCommands(template.commands.join('\n'));
            // Also set env vars from template
            if (Object.keys(template.envVars).length > 0) {
                setEnvVars(Object.entries(template.envVars).map(([key, value]) => ({ key, value })));
            }
        }
    };

    // Env vars handlers
    const addEnvVar = () => {
        setEnvVars([...envVars, { key: '', value: '' }]);
    };

    const updateEnvVar = (index: number, field: 'key' | 'value', value: string) => {
        setEnvironmentError('');
        const newEnvVars = [...envVars];
        newEnvVars[index][field] = value;
        setEnvVars(newEnvVars);
    };

    const removeEnvVar = (index: number) => {
        setEnvironmentError('');
        setEnvVars(envVars.filter((_, i) => i !== index));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (savingRef.current || phaseRef.current !== 'idle' || !name.trim() || !path.trim()) return;

        const commandList = commands
            .split('\n')
            .map(cmd => cmd.trim())
            .filter(cmd => cmd.length > 0);

        // Convert env vars array to object
        if (envVars.some(({ key, value }) => !key.trim() && value.length > 0)) {
            setEnvironmentError('Enter a name for each environment variable that has a value.');
            setActiveTab('env');
            return;
        }
        const keys = envVars.map(({ key }) => key.trim()).filter(Boolean);
        if (new Set(keys).size !== keys.length) {
            setEnvironmentError('Environment variable names must be unique. Remove or rename the duplicate.');
            setActiveTab('env');
            return;
        }
        const envVarsObj: Record<string, string> = Object.fromEntries(
            envVars.filter(({ key }) => key.trim()).map(({ key, value }) => [key.trim(), value])
        );

        invalidateDetection();
        savingRef.current = true;
        setIsSaving(true);
        try {
            await onSave(name, path, commandList, { autoStart, restartOnCrash }, envVarsObj);
            // A completed save must not dismiss a newer form opened after Cancel.
            if (mountedRef.current) onClose();
        } catch {
            // The caller reports the error; retain this draft for correction or retry.
        } finally {
            savingRef.current = false;
            if (mountedRef.current) setIsSaving(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={closeForm}>
            <div className="modal add-project-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{project ? 'Edit Project' : 'Add Project'}</h2>
                    <button className="close-btn" onClick={closeForm}>x</button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="modal-body project-scroll-region">
                        <fieldset className="project-fields" disabled={isSaving}>
                            {/* Drag & Drop Zone - also clickable */}
                            <div
                                className={`drop-zone ${isDragOver ? 'drag-over' : ''} ${detectionPhase === 'pending' ? 'detecting' : ''}`}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                                onClick={handleBrowseFolder}
                            >
                                {detectionPhase === 'pending' || detectionPhase === 'picking' ? (
                                    <>
                                        <span className="drop-icon">...</span>
                                        <p role="status">{detectionPhase === 'picking' ? 'Choosing project folder...' : 'Detecting project type...'}</p>
                                    </>
                                ) : (
                                    <>
                                        <span className="drop-icon">[+]</span>
                                        <p>Click to browse or drag & drop a folder</p>
                                        <p className="drop-hint">Auto-detects project type and suggests commands</p>
                                    </>
                                )}
                            </div>

                            {pickerError && <p className="form-error" role="alert">{pickerError}</p>}
                            {detectionPhase === 'error' && (
                                <div className="detection-error" role="alert">
                                    <p className="form-error">{detectionError}</p>
                                    <p>Your draft is unchanged. Retry detection, or continue manually and review the name and startup commands for this folder.</p>
                                    <div className="detection-actions">
                                        <button type="button" className="btn btn-secondary" onClick={() => choosePath(pathRef.current)}>Retry detection</button>
                                        <button type="button" className="btn btn-secondary" onClick={() => {
                                            invalidateDetection();
                                            setDetectionError('');
                                            changeDetectionPhase('idle');
                                            setActiveTab('commands');
                                        }}>Continue manually</button>
                                    </div>
                                </div>
                            )}

                            {projectType && (
                                <div className="detected-type">
                                    <span className="type-badge">{projectType}</span>
                                    {framework && <span className="framework-badge">{framework}</span>}
                                    <span>Detected!</span>
                                </div>
                            )}

                            {/* Command Suggestions */}
                            {suggestions.length > 0 && (
                                <div className="suggestions-section">
                                    <h4>Suggested Commands</h4>
                                    <p className="suggestions-hint">Check the commands you want to run on startup</p>
                                    <div className="suggestions-list">
                                        {suggestions.map((suggestion, index) => (
                                            <label
                                                key={index}
                                                className={`suggestion-item ${selectedSuggestions.has(index) ? 'selected' : ''}`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedSuggestions.has(index)}
                                                    onChange={() => toggleSuggestion(index)}
                                                />
                                                <div className="suggestion-content">
                                                    <div className="suggestion-command">
                                                        <code>{suggestion.command}</code>
                                                        {suggestion.is_recommended && (
                                                            <span className="recommended-badge">Recommended</span>
                                                        )}
                                                    </div>
                                                    <span className="suggestion-description">{suggestion.description}</span>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="form-group">
                                <label htmlFor="project-name">Project Name</label>
                                <input
                                    id="project-name"
                                    type="text"
                                    value={name}
                                    onChange={e => { nameEdited.current = true; setName(e.target.value); }}
                                    placeholder="e.g. My Bot"
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="project-path">Project Path</label>
                                <div className="input-with-button">
                                    <input
                                        id="project-path"
                                        type="text"
                                        value={path}
                                        onChange={e => choosePath(e.target.value, true)}
                                        placeholder="e.g. C:/Users/You/Documents/GitHub/mybot"
                                        required
                                    />
                                    <button
                                        type="button"
                                        className="browse-btn"
                                        onClick={handleBrowseFolder}
                                        disabled={detectionPhase === 'picking'}
                                    >
                                        Browse
                                    </button>
                                </div>
                                <span className="form-hint">Full path to project directory</span>
                            </div>

                            {/* Tabs */}
                            <div className="form-tabs">
                                <button
                                    type="button"
                                    className={`tab-btn ${activeTab === 'commands' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('commands')}
                                >
                                    Commands
                                </button>
                                <button
                                    type="button"
                                    className={`tab-btn ${activeTab === 'env' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('env')}
                                >
                                    Environment ({envVars.length})
                                </button>
                                <button
                                    type="button"
                                    className={`tab-btn ${activeTab === 'options' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('options')}
                                >
                                    Options
                                </button>
                            </div>

                            {/* Commands Tab */}
                            {activeTab === 'commands' && (
                                <>
                                    <div className="form-group">
                                        <div className="commands-header">
                                            <label htmlFor="project-commands">Startup Commands</label>
                                            <select
                                                className="template-select"
                                                onChange={e => handleTemplateChange(e.target.value)}
                                                defaultValue=""
                                            >
                                                <option value="" disabled>Apply template...</option>
                                                {projectTemplates.map(t => (
                                                    <option key={t.id} value={t.id}>{t.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <textarea
                                            id="project-commands"
                                            value={commands}
                                            onChange={e => {
                                                commandsEdited.current = true;
                                                setSelectedSuggestions(new Set());
                                                setCommands(e.target.value);
                                            }}
                                            placeholder={`source .venv/Scripts/activate\npython main.py`}
                                            rows={5}
                                        />
                                        <span className="form-hint">One command per line. These will run in Git Bash.</span>
                                    </div>

                                    <div className="command-preview">
                                        <h4>Preview</h4>
                                        <code>
                                            cd "{path || '/your/project/path'}"<br />
                                            {commands.split('\n').filter(c => c.trim()).map((cmd, i) => (
                                                <span key={i}>{cmd}<br /></span>
                                            ))}
                                        </code>
                                    </div>
                                </>
                            )}

                            {/* Environment Variables Tab */}
                            {activeTab === 'env' && (
                                <div className="env-vars-section">
                                    {environmentError && <p className="form-error" role="alert">{environmentError}</p>}
                                    <p className="section-description">
                                        Set environment variables for this project. Restart a running project to apply changes.
                                    </p>

                                    <div className="env-vars-list">
                                        {envVars.map((env, index) => (
                                            <div key={index} className="env-var-row">
                                                <input
                                                    type="text"
                                                    placeholder="KEY"
                                                    value={env.key}
                                                    onChange={e => updateEnvVar(index, 'key', e.target.value)}
                                                    className="env-key"
                                                />
                                                <span className="env-equals">=</span>
                                                <input
                                                    type="text"
                                                    placeholder="value"
                                                    value={env.value}
                                                    onChange={e => updateEnvVar(index, 'value', e.target.value)}
                                                    className="env-value"
                                                />
                                                <button
                                                    type="button"
                                                    className="env-remove"
                                                    onClick={() => removeEnvVar(index)}
                                                >
                                                    x
                                                </button>
                                            </div>
                                        ))}
                                    </div>

                                    <button type="button" className="add-env-btn" onClick={addEnvVar}>
                                        + Add Variable
                                    </button>
                                </div>
                            )}

                            {/* Options Tab */}
                            {activeTab === 'options' && (
                                <div className="options-section">
                                    <label className="option-item">
                                        <input
                                            type="checkbox"
                                            checked={autoStart}
                                            onChange={e => setAutoStart(e.target.checked)}
                                        />
                                        <div className="option-info">
                                            <span className="option-title">Auto-start on launch</span>
                                            <span className="option-desc">Start this project when DevBoot opens</span>
                                        </div>
                                    </label>

                                    <label className="option-item">
                                        <input
                                            type="checkbox"
                                            checked={restartOnCrash}
                                            onChange={e => setRestartOnCrash(e.target.checked)}
                                        />
                                        <div className="option-info">
                                            <span className="option-title">Auto-restart on crash</span>
                                            <span className="option-desc">Automatically restart if the process crashes (max 5 attempts)</span>
                                        </div>
                                    </label>
                                </div>
                            )}
                        </fieldset>
                    </div>

                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={closeForm}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={isSaving || detectionPhase !== 'idle'}>
                            {isSaving ? 'Saving...' : project ? 'Save Changes' : 'Add Project'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
