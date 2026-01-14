import { useState, DragEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Project } from '../types';
import './AddProject.css';

interface DetectedProjectInfo {
    name: string;
    project_type: string;
    suggested_commands: string[];
}

interface AddProjectProps {
    project?: Project | null;
    onSave: (name: string, path: string, commands: string[]) => void;
    onClose: () => void;
}

export function AddProject({ project, onSave, onClose }: AddProjectProps) {
    const [name, setName] = useState(project?.name || '');
    const [path, setPath] = useState(project?.path || '');
    const [commands, setCommands] = useState(project?.commands.join('\n') || '');
    const [projectType, setProjectType] = useState<string>('');
    const [isDragOver, setIsDragOver] = useState(false);
    const [isDetecting, setIsDetecting] = useState(false);

    const detectProject = async (folderPath: string) => {
        setIsDetecting(true);
        try {
            const detected = await invoke<DetectedProjectInfo>('detect_project_from_path', {
                path: folderPath
            });

            setName(detected.name);
            setPath(folderPath);
            setProjectType(detected.project_type);

            if (detected.suggested_commands.length > 0) {
                setCommands(detected.suggested_commands.join('\n'));
            }
        } catch (error) {
            console.error('Failed to detect project:', error);
        } finally {
            setIsDetecting(false);
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
            // Get the folder path from dropped item
            const file = files[0];
            // For folders, we need the path - webkitRelativePath or path
            let folderPath = (file as any).path || file.name;

            // If it's a file, get parent directory
            if (folderPath.includes('.')) {
                folderPath = folderPath.substring(0, folderPath.lastIndexOf('\\'));
            }

            await detectProject(folderPath);
        }
    };

    const handlePathChange = async (newPath: string) => {
        setPath(newPath);

        // Auto-detect when path looks complete (ends with folder name, not slash)
        if (newPath && !newPath.endsWith('/') && !newPath.endsWith('\\') && newPath.length > 5) {
            // Debounce - wait a bit before detecting
            setTimeout(() => {
                if (newPath === path || newPath.length > path.length) {
                    detectProject(newPath);
                }
            }, 500);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !path.trim()) return;

        const commandList = commands
            .split('\n')
            .map(cmd => cmd.trim())
            .filter(cmd => cmd.length > 0);

        onSave(name, path, commandList);
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal add-project-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{project ? '✏️ Edit Project' : '➕ Add Project'}</h2>
                    <button className="close-btn" onClick={onClose}>✕</button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        {/* Drag & Drop Zone */}
                        <div
                            className={`drop-zone ${isDragOver ? 'drag-over' : ''} ${isDetecting ? 'detecting' : ''}`}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                        >
                            {isDetecting ? (
                                <>
                                    <span className="drop-icon">🔍</span>
                                    <p>Detecting project type...</p>
                                </>
                            ) : (
                                <>
                                    <span className="drop-icon">📂</span>
                                    <p>Drag & drop a folder here</p>
                                    <p className="drop-hint">or fill in the form below</p>
                                </>
                            )}
                        </div>

                        {projectType && (
                            <div className="detected-type">
                                <span className="type-badge">{projectType}</span>
                                <span>Project detected!</span>
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
                            <input
                                id="project-path"
                                type="text"
                                value={path}
                                onChange={e => handlePathChange(e.target.value)}
                                placeholder="e.g. C:/Users/You/Documents/GitHub/mybot"
                                required
                            />
                            <span className="form-hint">Full path to project directory</span>
                        </div>

                        <div className="form-group">
                            <label htmlFor="project-commands">Commands</label>
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
                            <h4>📟 Preview</h4>
                            <code>
                                cd "{path || '/your/project/path'}"<br />
                                {commands.split('\n').filter(c => c.trim()).map((cmd, i) => (
                                    <span key={i}>{cmd}<br /></span>
                                ))}
                            </code>
                        </div>
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
