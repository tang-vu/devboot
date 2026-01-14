import { Project, ProcessStatus } from '../types';
import './Sidebar.css';

interface SidebarProps {
    projects: Project[];
    statuses: Record<string, ProcessStatus>;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onStart: (id: string) => void;
    onStop: (id: string) => void;
    onAddProject: () => void;
    onOpenSettings: () => void;
}

export function Sidebar({
    projects,
    statuses,
    selectedId,
    onSelect,
    onStart,
    onStop,
    onAddProject,
    onOpenSettings,
}: SidebarProps) {
    const getStatusColor = (status: ProcessStatus) => {
        switch (status) {
            case 'running': return '#10b981';
            case 'error': return '#ef4444';
            case 'restarting': return '#f59e0b';
            default: return '#6b7280';
        }
    };

    const getStatusIcon = (status: ProcessStatus) => {
        switch (status) {
            case 'running': return '▶';
            case 'error': return '⚠';
            case 'restarting': return '↻';
            default: return '■';
        }
    };

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <h1 className="app-title">
                    <span className="app-icon">⚡</span>
                    DevBoot
                </h1>
            </div>

            <div className="sidebar-section">
                <h2 className="section-title">PROJECTS</h2>
                <div className="project-list">
                    {projects.map((project) => {
                        const status = statuses[project.id] || 'stopped';
                        const isSelected = selectedId === project.id;
                        const isRunning = status === 'running';

                        return (
                            <div
                                key={project.id}
                                className={`project-item ${isSelected ? 'selected' : ''}`}
                                onClick={() => onSelect(project.id)}
                            >
                                <div className="project-info">
                                    <span
                                        className="status-dot"
                                        style={{ backgroundColor: getStatusColor(status) }}
                                    />
                                    <span className="project-name">{project.name}</span>
                                </div>
                                <div className="project-status">
                                    <span className="status-icon">{getStatusIcon(status)}</span>
                                    <span className="status-text">{status}</span>
                                </div>
                                <div className="project-actions">
                                    {isRunning ? (
                                        <button
                                            className="action-btn stop"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onStop(project.id);
                                            }}
                                            title="Stop"
                                        >
                                            ■
                                        </button>
                                    ) : (
                                        <button
                                            className="action-btn start"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onStart(project.id);
                                            }}
                                            title="Start"
                                        >
                                            ▶
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="sidebar-footer">
                <button className="footer-btn add-btn" onClick={onAddProject}>
                    <span>+</span> Add Project
                </button>
                <button className="footer-btn settings-btn" onClick={onOpenSettings}>
                    <span>⚙</span> Settings
                </button>
            </div>
        </aside>
    );
}
