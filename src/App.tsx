import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Terminal } from './components/Terminal';
import { Settings } from './components/Settings';
import { AddProject } from './components/AddProject';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ToastProvider, useToast } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useProjects, useSettings } from './hooks/useProjects';
import { Project } from './types';
import './App.css';

function AppContent() {
  const {
    projects,
    loading,
    statuses,
    logs,
    addProject,
    updateProject,
    deleteProject,
    startProject,
    stopProject,
    restartProject,
    clearLogs,
  } = useProjects();

  const { settings, updateSettings } = useSettings();
  const toast = useToast();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);

  // Get selected project
  const selectedProject = projects.find(p => p.id === selectedProjectId);

  // Auto-select first project if none selected
  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [selectedProjectId, projects]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if in input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'n':
            e.preventDefault();
            setShowAddProject(true);
            break;
          case ',':
            e.preventDefault();
            setShowSettings(true);
            break;
          case 'enter':
            e.preventDefault();
            if (selectedProject && statuses[selectedProject.id] !== 'running') {
              handleStartProject(selectedProject.id);
            }
            break;
          case '.':
            e.preventDefault();
            if (selectedProject && statuses[selectedProject.id] === 'running') {
              handleStopProject(selectedProject.id);
            }
            break;
          case 'r':
            e.preventDefault();
            if (selectedProject) {
              handleRestartProject(selectedProject.id);
            }
            break;
          case 'l':
            e.preventDefault();
            if (selectedProject) {
              clearLogs(selectedProject.id);
              toast.info('Logs cleared');
            }
            break;
        }
      }

      // Escape to close modals
      if (e.key === 'Escape') {
        setShowSettings(false);
        setShowAddProject(false);
        setEditingProject(null);
        setDeletingProject(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedProject, statuses]);

  // Handlers with toast notifications
  const handleAddProject = async (name: string, path: string, commands: string[], _envVars?: Record<string, string>) => {
    try {
      // Note: envVars will be saved when updating the project after creation
      await addProject(name, path, commands);
      toast.success(`Project "${name}" added successfully`);
      setShowAddProject(false);
    } catch (error) {
      toast.error(`Failed to add project: ${error}`);
    }
  };

  const handleUpdateProject = async (name: string, path: string, commands: string[], envVars?: Record<string, string>) => {
    if (!editingProject) return;
    try {
      await updateProject({
        ...editingProject,
        name,
        path,
        commands,
        env_vars: envVars || editingProject.env_vars,
      });
      toast.success(`Project "${name}" updated successfully`);
      setEditingProject(null);
    } catch (error) {
      toast.error(`Failed to update project: ${error}`);
    }
  };

  const handleDeleteProject = async () => {
    if (!deletingProject) return;
    try {
      await deleteProject(deletingProject.id);
      toast.success(`Project "${deletingProject.name}" deleted`);
      setDeletingProject(null);
      // If deleted project was selected, clear selection
      if (selectedProjectId === deletingProject.id) {
        setSelectedProjectId(null);
      }
    } catch (error) {
      toast.error(`Failed to delete project: ${error}`);
    }
  };

  const handleStartProject = async (projectId: string) => {
    try {
      await startProject(projectId);
      const project = projects.find(p => p.id === projectId);
      toast.success(`Started "${project?.name}"`);
    } catch (error) {
      toast.error(`Failed to start project: ${error}`);
    }
  };

  const handleStopProject = async (projectId: string) => {
    try {
      await stopProject(projectId);
      const project = projects.find(p => p.id === projectId);
      toast.info(`Stopped "${project?.name}"`);
    } catch (error) {
      toast.error(`Failed to stop project: ${error}`);
    }
  };

  const handleRestartProject = async (projectId: string) => {
    try {
      await restartProject(projectId);
      const project = projects.find(p => p.id === projectId);
      toast.success(`Restarted "${project?.name}"`);
    } catch (error) {
      toast.error(`Failed to restart project: ${error}`);
    }
  };

  const handleSettingsSave = async (newSettings: typeof settings) => {
    try {
      await updateSettings(newSettings);
      toast.success('Settings saved');
      setShowSettings(false);
    } catch (error) {
      toast.error(`Failed to save settings: ${error}`);
    }
  };

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
        onStart={handleStartProject}
        onStop={handleStopProject}
        onEdit={setEditingProject}
        onDelete={setDeletingProject}
        onAddProject={() => setShowAddProject(true)}
        onOpenSettings={() => setShowSettings(true)}
      />

      <main className="main-content">
        {selectedProject ? (
          <Terminal
            projectId={selectedProject.id}
            projectName={selectedProject.name}
            logs={logs[selectedProject.id] || []}
            onClear={() => {
              clearLogs(selectedProject.id);
              toast.info('Logs cleared');
            }}
            onRestart={() => handleRestartProject(selectedProject.id)}
            onStop={() => handleStopProject(selectedProject.id)}
            onStart={() => handleStartProject(selectedProject.id)}
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
                + Add Project
              </button>
              <p className="shortcut-hint">or press Ctrl+N</p>
            </div>
          </div>
        )}
      </main>

      {showSettings && (
        <Settings
          settings={settings}
          onSave={handleSettingsSave}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showAddProject && (
        <AddProject
          onSave={handleAddProject}
          onClose={() => setShowAddProject(false)}
        />
      )}

      {editingProject && (
        <AddProject
          project={editingProject}
          onSave={handleUpdateProject}
          onClose={() => setEditingProject(null)}
        />
      )}

      {deletingProject && (
        <ConfirmDialog
          title="Delete Project"
          message={`Are you sure you want to delete "${deletingProject.name}"? This action cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
          confirmVariant="danger"
          onConfirm={handleDeleteProject}
          onCancel={() => setDeletingProject(null)}
        />
      )}
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
