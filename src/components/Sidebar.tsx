import { useState } from 'react';
import { Project, ProcessStatus } from '../types';
import './Sidebar.css';

interface SidebarProps {
    projects: Project[];
    statuses: Record<string, ProcessStatus>;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onStart: (id: string) => void;
    onStop: (id: string) => void;
    onEdit: (project: Project) => void;
    onDelete: (project: Project) => void;
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
    onEdit,
    onDelete,
    onAddProject,
    onOpenSettings,
}: SidebarProps) {
    const [searchQuery, setSearchQuery] = useState('');

    const getStatusColor = (status: ProcessStatus) => {
        switch (status) {
            case 'running': return 'var(--success)';
            case 'error': return 'var(--error)';
            case 'restarting': return 'var(--warning)';
            default: return 'var(--text-muted)';
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

    // Filter projects by search query
    const filteredProjects = projects.filter(project =>
        project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        project.path.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <h1 className="app-title">
                    <span className="app-icon">⚡</span>
                    DevBoot
                </h1>
            </div>

            <div className="sidebar-section">
                <div className="section-header">
                    <h2 className="section-title">PROJECTS</h2>
                    <span className="project-count">{projects.length}</span>
                </div>

                {/* Search input */}
                {projects.length > 0 && (
                    <div className="search-box">
                        <span className="search-icon">🔍</span>
                        <input
                            type="text"
                            placeholder="Search projects..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="search-input"
                        />
                        {searchQuery && (
                            <button 
                                className="search-clear"
                                onClick={() => setSearchQuery('')}
                            >
                                ✕
                            </button>
                        )}
                    </div>
                )}

                <div className="project-list">
                    {filteredProjects.map((project) => {
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
                                            title="Stop (Ctrl+.)"
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
                                            title="Start (Ctrl+Enter)"
                                        >
                                            ▶
                                        </button>
                                    )}
                                    <button
                                        className="action-btn edit"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onEdit(project);
                                        }}
                                        title="Edit project"
                                    >
                                        ✎
                                    </button>
                                    <button
                                        className="action-btn delete"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDelete(project);
                                        }}
                                        title="Delete project"
                                    >
                                        🗑
                                    </button>
                                </div>
                            </div>
                        );
                    })}

                    {filteredProjects.length === 0 && searchQuery && (
                        <div className="no-results">
                            <span>No projects match "{searchQuery}"</span>
                        </div>
                    )}
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
