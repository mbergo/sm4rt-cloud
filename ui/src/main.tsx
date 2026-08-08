import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import { dark } from '@clerk/themes';
import App from './App';
import { ConfigContext, fetchConfig } from './lib/config';
import './index.css';

const root = createRoot(document.getElementById('root')!);

void fetchConfig().then((config) => {
  const app = (
    <ConfigContext.Provider value={config}>
      <App />
    </ConfigContext.Provider>
  );
  root.render(
    <StrictMode>
      {config.authMode === 'clerk' && config.clerkPublishableKey ? (
        <ClerkProvider
          publishableKey={config.clerkPublishableKey}
          appearance={{
            baseTheme: dark,
            variables: {
              colorPrimary: '#f59e0b',
              colorBackground: '#1c1917',
              borderRadius: '0.75rem',
            },
          }}
        >
          {app}
        </ClerkProvider>
      ) : (
        app
      )}
    </StrictMode>,
  );
});
