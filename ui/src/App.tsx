import { CloudOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
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
import ClusterBar from './components/ClusterBar';
import CreateModal from './components/CreateModal';
import Console from './components/Console';
import Header from './components/Header';
import InstanceCard from './components/InstanceCard';
import Login from './components/Login';
import TokenLogin from './components/TokenLogin';
import Admin from './components/Admin';
import { useConfig } from './lib/config';
import { PrimaryButton, Toast } from './components/bits';

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

  const notify = useCallback((message: string, tone: ToastState['tone'] = 'ok') => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 3500);
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

  if (selected) {
    return (
      <div className="min-h-screen">
        <Header
          instanceCount={instances?.length ?? 0}
          onCreate={() => setCreateOpen(true)}
          showUserButton={showUserButton}
        />
        <Console
          name={selected}
          cluster={cluster}
          onBack={() => {
            setSelected(null);
            refresh();
          }}
          notify={notify}
        />
        {createOpen ? (
          <CreateModal
            onClose={() => setCreateOpen(false)}
            onCreated={(instance) => {
              setCreateOpen(false);
              notify(`Instance ${instance.name} is provisioning`);
              refresh();
              setSelected(instance.name);
            }}
          />
        ) : null}
        {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header
        instanceCount={instances?.length ?? 0}
        onCreate={() => setCreateOpen(true)}
        showUserButton={showUserButton}
        />

      <main className="mx-auto max-w-6xl px-6 py-8">
        <ClusterBar cluster={cluster} />

        <div className="mb-4 flex items-baseline gap-2">
          <h2 className="font-display text-sm font-bold tracking-tight">Environments</h2>
          <span className="text-xs text-stone-500">
            isolated AWS workspaces running on the cluster
          </span>
        </div>

        {instances === null ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="h-44 animate-pulse rounded-2xl border border-white/5 bg-white/[0.03]"
              />
            ))}
          </div>
        ) : instances.length === 0 ? (
          <div className="animate-rise-in mx-auto mt-16 flex max-w-md flex-col items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-8 py-14 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
              <CloudOff className="h-6 w-6 text-stone-500" />
            </div>
            <h2 className="mt-5 font-display text-xl font-bold tracking-tight">
              No environments yet
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-400">
              Spin up an isolated AWS environment in seconds. Each one gets its own endpoint ready
              for the AWS CLI, SDKs and Terraform — all running on the cluster above.
            </p>
            <PrimaryButton onClick={() => setCreateOpen(true)} className="mt-6">
              Create your first environment
            </PrimaryButton>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {instances.map((instance) => (
              <InstanceCard
                key={instance.name}
                instance={instance}
                onSelect={() => setSelected(instance.name)}
                onDelete={() => {
                  deleteInstance(instance.name)
                    .then(() => {
                      notify(`Deleting ${instance.name}`);
                      refresh();
                    })
                    .catch(() => notify(`Failed to delete ${instance.name}`, 'err'));
                }}
              />
            ))}
          </div>
        )}
      </main>

      {createOpen ? (
        <CreateModal
          onClose={() => setCreateOpen(false)}
          onCreated={(instance) => {
            setCreateOpen(false);
            notify(`Instance ${instance.name} is provisioning`);
            refresh();
            setSelected(instance.name);
          }}
        />
      ) : null}


      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </div>
  );
}
