import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Terminal } from './components/Terminal';
import { Settings } from './components/Settings';
import { AddProject } from './components/AddProject';
import { useProjects, useSettings } from './hooks/useProjects';
import './App.css';

function App() {
  const {
    projects,
    loading,
    statuses,
    logs,
    addProject,
    startProject,
    stopProject,
    restartProject,
    clearLogs,
  } = useProjects();

  const { settings, updateSettings } = useSettings();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);

  // Get selected project
  const selectedProject = projects.find(p => p.id === selectedProjectId);

  // Auto-select first project if none selected
  if (!selectedProjectId && projects.length > 0) {
    setSelectedProjectId(projects[0].id);
  }

  if (loading) {
    return (
      <div className="app loading">
        <div className="loader">
          <span className="loader-icon">⚡</span>
          <span>Loading DevBoot...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        projects={projects}
        statuses={statuses}
        selectedId={selectedProjectId}
        onSelect={setSelectedProjectId}
        onStart={startProject}
        onStop={stopProject}
        onAddProject={() => setShowAddProject(true)}
        onOpenSettings={() => setShowSettings(true)}
      />

      <main className="main-content">
        {selectedProject ? (
          <Terminal
            projectName={selectedProject.name}
            logs={logs[selectedProject.id] || []}
            onClear={() => clearLogs(selectedProject.id)}
            onRestart={() => restartProject(selectedProject.id)}
            onStop={() => stopProject(selectedProject.id)}
            isRunning={statuses[selectedProject.id] === 'running'}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-content">
              <span className="empty-icon">📂</span>
              <h2>No Projects Yet</h2>
              <p>Add your first project to get started</p>
              <button
                className="btn btn-primary"
                onClick={() => setShowAddProject(true)}
              >
                ➕ Add Project
              </button>
            </div>
          </div>
        )}
      </main>

      {showSettings && (
        <Settings
          settings={settings}
          onSave={updateSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showAddProject && (
        <AddProject
          onSave={(name, path, commands) => {
            addProject(name, path, commands);
            setShowAddProject(false);
          }}
          onClose={() => setShowAddProject(false)}
        />
      )}
    </div>
  );
}

export default App;
