import { useState } from 'react';
import { Project } from '../types';
import './AddProject.css';

interface AddProjectProps {
    project?: Project | null;
    onSave: (name: string, path: string, commands: string[]) => void;
    onClose: () => void;
}

export function AddProject({ project, onSave, onClose }: AddProjectProps) {
    const [name, setName] = useState(project?.name || '');
    const [path, setPath] = useState(project?.path || '');
    const [commands, setCommands] = useState(project?.commands.join('\n') || '');

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
                                onChange={e => setPath(e.target.value)}
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
