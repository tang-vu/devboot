import { useState, DragEvent, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Project, CommandSuggestion, DetectedProjectInfo } from '../types';
import { projectTemplates } from '../data/templates';
import './AddProject.css';

interface AddProjectProps {
    project?: Project | null;
    onSave: (name: string, path: string, commands: string[], envVars?: Record<string, string>) => void;
    onClose: () => void;
}

export function AddProject({ project, onSave, onClose }: AddProjectProps) {
    const [name, setName] = useState(project?.name || '');
    const [path, setPath] = useState(project?.path || '');
    const [commands, setCommands] = useState(project?.commands.join('\n') || '');
    const [projectType, setProjectType] = useState<string>('');
    const [framework, setFramework] = useState<string | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isDetecting, setIsDetecting] = useState(false);
    const [activeTab, setActiveTab] = useState<'commands' | 'env' | 'options'>('commands');
    
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

    // Sync selected suggestions to commands textarea
    useEffect(() => {
        if (suggestions.length > 0) {
            const selectedCommands = suggestions
                .filter((_, index) => selectedSuggestions.has(index))
                .map(s => s.command);
            setCommands(selectedCommands.join('\n'));
        }
    }, [selectedSuggestions, suggestions]);

    const detectProject = async (folderPath: string) => {
        setIsDetecting(true);
        try {
            const detected = await invoke<DetectedProjectInfo>('detect_project_from_path', {
                path: folderPath
            });

            setName(detected.name);
            setPath(folderPath);
            setProjectType(detected.project_type);
            setFramework(detected.framework);
            setSuggestions(detected.suggestions);

            // Auto-select recommended suggestions
            const recommendedIndexes = new Set<number>();
            detected.suggestions.forEach((s, index) => {
                if (s.is_recommended) {
                    recommendedIndexes.add(index);
                }
            });
            setSelectedSuggestions(recommendedIndexes);
        } catch (error) {
            console.error('Failed to detect project:', error);
        } finally {
            setIsDetecting(false);
        }
    };

    // Open folder picker dialog
    const handleBrowseFolder = async () => {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: 'Select Project Folder',
            });
            
            if (selected && typeof selected === 'string') {
                await detectProject(selected);
            }
        } catch (error) {
            console.error('Failed to open folder dialog:', error);
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

    const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            let folderPath = (file as any).path || file.name;

            if (folderPath.includes('.')) {
                folderPath = folderPath.substring(0, folderPath.lastIndexOf('\\'));
            }

            await detectProject(folderPath);
        }
    };

    const handlePathChange = async (newPath: string) => {
        setPath(newPath);

        if (newPath && !newPath.endsWith('/') && !newPath.endsWith('\\') && newPath.length > 5) {
            setTimeout(() => {
                if (newPath === path || newPath.length > path.length) {
                    detectProject(newPath);
                }
            }, 500);
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
        setSelectedSuggestions(newSelected);
    };

    // Apply template
    const handleTemplateChange = (templateId: string) => {
        const template = projectTemplates.find(t => t.id === templateId);
        if (template) {
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
        const newEnvVars = [...envVars];
        newEnvVars[index][field] = value;
        setEnvVars(newEnvVars);
    };

    const removeEnvVar = (index: number) => {
        setEnvVars(envVars.filter((_, i) => i !== index));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !path.trim()) return;

        const commandList = commands
            .split('\n')
            .map(cmd => cmd.trim())
            .filter(cmd => cmd.length > 0);

        // Convert env vars array to object
        const envVarsObj: Record<string, string> = {};
        envVars.forEach(({ key, value }) => {
            if (key.trim()) {
                envVarsObj[key.trim()] = value;
            }
        });

        onSave(name, path, commandList, envVarsObj);
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal add-project-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{project ? 'Edit Project' : 'Add Project'}</h2>
                    <button className="close-btn" onClick={onClose}>x</button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        {/* Drag & Drop Zone - also clickable */}
                        <div
                            className={`drop-zone ${isDragOver ? 'drag-over' : ''} ${isDetecting ? 'detecting' : ''}`}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            onClick={handleBrowseFolder}
                        >
                            {isDetecting ? (
                                <>
                                    <span className="drop-icon">...</span>
                                    <p>Detecting project type...</p>
                                </>
                            ) : (
                                <>
                                    <span className="drop-icon">[+]</span>
                                    <p>Click to browse or drag & drop a folder</p>
                                    <p className="drop-hint">Auto-detects project type and suggests commands</p>
                                </>
                            )}
                        </div>

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
                                onChange={e => setName(e.target.value)}
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
                                    onChange={e => handlePathChange(e.target.value)}
                                    placeholder="e.g. C:/Users/You/Documents/GitHub/mybot"
                                    required
                                />
                                <button 
                                    type="button" 
                                    className="browse-btn"
                                    onClick={handleBrowseFolder}
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
                                        onChange={e => setCommands(e.target.value)}
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
                                <p className="section-description">
                                    Set environment variables for this project. These will be available to your commands.
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
                    </div>

                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary">
                            {project ? 'Save Changes' : 'Add Project'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
