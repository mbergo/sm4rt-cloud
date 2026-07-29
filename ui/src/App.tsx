import { CloudOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Show, useAuth } from '@clerk/react';
import {
  ApiError,
  deleteInstance,
  listInstances,
  setTokenProvider,
  type Instance,
} from './lib/api';
import CreateModal from './components/CreateModal';
import Console from './components/Console';
import Header from './components/Header';
import InstanceCard from './components/InstanceCard';
import Login from './components/Login';
import { PrimaryButton, Toast } from './components/bits';

interface ToastState {
  message: string;
  tone: 'ok' | 'err';
}

export default function App() {
  return (
    <>
      <Show when="signed-out">
        <Login />
      </Show>
      <Show when="signed-in">
        <Dashboard />
      </Show>
    </>
  );
}

function Dashboard() {
  const { getToken, signOut } = useAuth();
  const [ready, setReady] = useState(false);
  const [instances, setInstances] = useState<Instance[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    setTokenProvider(() => getToken());
    setReady(true);
    return () => {
      setTokenProvider(null);
    };
  }, [getToken]);

  const notify = useCallback((message: string, tone: ToastState['tone'] = 'ok') => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const refresh = useCallback(() => {
    listInstances()
      .then((data) => setInstances(data.instances))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          void signOut();
        }
      });
  }, [signOut]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [ready, refresh]);

  if (selected) {
    return (
      <div className="min-h-screen">
        <Header
          instanceCount={instances?.length ?? 0}
          onCreate={() => setCreateOpen(true)}
        />
        <Console
          name={selected}
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
      />

      <main className="mx-auto max-w-6xl px-6 py-8">
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
              No instances yet
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-400">
              Spin up an isolated AWS environment in seconds. Each instance gets its own endpoint
              ready for the AWS CLI, SDKs and Terraform.
            </p>
            <PrimaryButton onClick={() => setCreateOpen(true)} className="mt-6">
              Create your first instance
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
