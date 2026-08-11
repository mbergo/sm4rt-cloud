import { useCallback, useEffect, useRef, useState } from 'react';
import { Show, useAuth } from '@clerk/react';
import {
  ApiError,
  clearToken,
  deleteInstance,
  getCluster,
  getToken as getStoredToken,
  listInstances,
  setTokenProvider,
  type ClusterInfo,
  type Instance,
} from './lib/api';
import CreateModal from './components/CreateModal';
import Console from './components/Console';
import Header from './components/Header';
import Login from './components/Login';
import TokenLogin from './components/TokenLogin';
import Admin from './components/Admin';
import { useConfig } from './lib/config';
import { Toast } from './components/bits';

const LAST_WORKSPACE_KEY = 'sm4rt.lastWorkspace';

interface ToastState {
  message: string;
  tone: 'ok' | 'err';
}

export default function App() {
  const config = useConfig();
  if (window.location.pathname.startsWith('/admin')) {
    return <Admin />;
  }
  if (config.authMode === 'clerk' && config.clerkPublishableKey) {
    return <ClerkGate />;
  }
  if (config.authMode === 'token') {
    return <TokenGate />;
  }
  return <Dashboard onUnauthorized={() => undefined} showUserButton={false} />;
}

function ClerkGate() {
  return (
    <>
      <Show when="signed-out">
        <Login />
      </Show>
      <Show when="signed-in">
        <ClerkDashboard />
      </Show>
    </>
  );
}

function ClerkDashboard() {
  const { getToken, signOut } = useAuth();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTokenProvider(() => getToken());
    setReady(true);
    return () => {
      setTokenProvider(null);
    };
  }, [getToken]);

  if (!ready) {
    return null;
  }
  return <Dashboard onUnauthorized={() => void signOut()} showUserButton />;
}

function TokenGate() {
  const [signedIn, setSignedIn] = useState(() => Boolean(getStoredToken()));

  if (!signedIn) {
    return <TokenLogin onSignedIn={() => setSignedIn(true)} />;
  }
  return (
    <Dashboard
      onUnauthorized={() => {
        clearToken();
        setSignedIn(false);
      }}
      showUserButton={false}
    />
  );
}

function Dashboard({
  onUnauthorized,
  showUserButton,
}: {
  onUnauthorized: () => void;
  showUserButton: boolean;
}) {
  const [instances, setInstances] = useState<Instance[] | null>(null);
  const [cluster, setCluster] = useState<ClusterInfo | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const autoSelected = useRef(false);

  const notify = useCallback((message: string, tone: ToastState['tone'] = 'ok') => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const selectWorkspace = useCallback((name: string | null) => {
    setSelected(name);
    if (name) {
      localStorage.setItem(LAST_WORKSPACE_KEY, name);
    } else {
      localStorage.removeItem(LAST_WORKSPACE_KEY);
    }
  }, []);

  const refresh = useCallback(() => {
    listInstances()
      .then((data) => setInstances(data.instances))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          onUnauthorized();
        }
      });
  }, [onUnauthorized]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    let active = true;
    const load = () => {
      getCluster()
        .then((data) => {
          if (active) setCluster(data);
        })
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  // Auto-select workspace once instances load: last used, else first, else open create modal.
  useEffect(() => {
    if (instances === null || autoSelected.current) {
      return;
    }
    autoSelected.current = true;
    const last = localStorage.getItem(LAST_WORKSPACE_KEY);
    if (last && instances.some((instance) => instance.name === last)) {
      setSelected(last);
    } else if (instances.length > 0) {
      selectWorkspace(instances[0].name);
    } else {
      setCreateOpen(true);
    }
  }, [instances, selectWorkspace]);

  // If the selected workspace disappears (deleted elsewhere), fall back to the next one.
  useEffect(() => {
    if (instances === null || !selected) {
      return;
    }
    if (!instances.some((instance) => instance.name === selected)) {
      selectWorkspace(instances.length > 0 ? instances[0].name : null);
      if (instances.length === 0) {
        setCreateOpen(true);
      }
    }
  }, [instances, selected, selectWorkspace]);

  const handleDelete = useCallback(
    (name: string) => {
      deleteInstance(name)
        .then(() => {
          notify(`Deleting ${name}`);
          if (selected === name) {
            const rest = (instances ?? []).filter((instance) => instance.name !== name);
            selectWorkspace(rest.length > 0 ? rest[0].name : null);
            if (rest.length === 0) {
              setCreateOpen(true);
            }
          }
          refresh();
        })
        .catch(() => notify(`Failed to delete ${name}`, 'err'));
    },
    [instances, notify, refresh, selectWorkspace, selected],
  );

  return (
    <div className="min-h-screen">
      <Header
        instances={instances ?? []}
        selected={selected}
        onSelect={selectWorkspace}
        onDelete={handleDelete}
        onCreate={() => setCreateOpen(true)}
        showUserButton={showUserButton}
      />

      {selected ? (
        <Console
          key={selected}
          name={selected}
          cluster={cluster}
          onBack={() => {
            const rest = (instances ?? []).filter((instance) => instance.name !== selected);
            selectWorkspace(rest.length > 0 ? rest[0].name : null);
            if (rest.length === 0) {
              setCreateOpen(true);
            }
            refresh();
          }}
          notify={notify}
        />
      ) : instances === null ? (
        <main className="w-full px-8 py-8">
          <div className="h-40 animate-pulse rounded-2xl border border-white/5 bg-white/[0.03]" />
        </main>
      ) : null}

      {createOpen ? (
        <CreateModal
          onClose={() => setCreateOpen(false)}
          onCreated={(instance) => {
            setCreateOpen(false);
            notify(`Workspace ${instance.name} is provisioning`);
            refresh();
            selectWorkspace(instance.name);
          }}
        />
      ) : null}

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </div>
  );
}
