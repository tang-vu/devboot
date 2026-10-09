import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Terminal } from './components/Terminal';
import { Settings } from './components/Settings';
import { AddProject } from './components/AddProject';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ToastProvider, useToast } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useProjects, useSettings } from './hooks/useProjects';
import { Project, ProjectOptions, Settings as SettingsType } from './types';
import './App.css';

function AppContent() {
  const {
    projects,
    loading,
    statuses,
    logViews,
    logErrors,
    refreshProjects,
    addProject,
    updateProject,
    deleteProject,
    startProject,
    stopProject,
    restartProject,
    clearLogs,
  } = useProjects();

  const {
    settings, loading: settingsLoading, loadError: settingsLoadError,
    savingSettings, failedSettings, saveError: settingsSaveError,
    startupError: settingsStartupError, updateSettings,
    retryLoad: retrySettingsLoad, dismissSaveError,
  } = useSettings();
  const toast = useToast();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);

  const closeSettings = useCallback(() => {
    if (!showSettings) return;
    setShowSettings(false);
    dismissSaveError();
  }, [showSettings, dismissSaveError]);

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
        closeSettings();
        setShowAddProject(false);
        setEditingProject(null);
        setDeletingProject(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedProject, statuses, closeSettings]);

  // Handlers with toast notifications
  const handleAddProject = async (name: string, path: string, commands: string[], options: ProjectOptions, envVars?: Record<string, string>) => {
    try {
      await addProject(name, path, commands, options, envVars);
      toast.success(`Project "${name}" added successfully`);
    } catch (error) {
      toast.error(`Failed to add project: ${error}`);
      throw error;
    }
  };

  const handleUpdateProject = async (name: string, path: string, commands: string[], options: ProjectOptions, envVars?: Record<string, string>) => {
    if (!editingProject) return;
    try {
      await updateProject({
        ...editingProject,
        name,
        path,
        commands,
        auto_start: options.autoStart,
        restart_on_crash: options.restartOnCrash,
        env_vars: envVars || editingProject.env_vars,
      });
      toast.success(`Project "${name}" updated successfully`);
    } catch (error) {
      toast.error(`Failed to update project: ${error}`);
      throw error;
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

  const handleSettingsSave = async (newSettings: SettingsType) => {
    try {
      await updateSettings(newSettings);
      toast.success('Settings saved');
    } catch (error) {
      toast.error(`${error}`);
      throw error;
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
            key={selectedProject.id}
            projectId={selectedProject.id}
            projectName={selectedProject.name}
            records={logViews[selectedProject.id]?.records || []}
            sessionId={logViews[selectedProject.id]?.sessionId ?? null}
            logError={logErrors[selectedProject.id]}
            onReloadLogs={() => { void refreshProjects(); }}
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
          settings={savingSettings ?? failedSettings ?? settings}
          loading={settingsLoading}
          loadError={settingsLoadError}
          saving={savingSettings !== null}
          saveError={settingsSaveError}
          startupError={settingsStartupError}
          onRetryLoad={retrySettingsLoad}
          onSave={handleSettingsSave}
          onClose={closeSettings}
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
