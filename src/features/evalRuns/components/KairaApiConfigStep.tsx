import { useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Wifi } from 'lucide-react';
import { Input, Button, Alert } from '@/components/ui';

interface KairaApiConfigStepProps {
  userId: string;
  kairaApiUrl: string;
  kairaAuthToken: string;
  onUserIdChange: (userId: string) => void;
  onApiUrlChange: (url: string) => void;
  onAuthTokenChange: (token: string) => void;
}

export function KairaApiConfigStep({
  userId,
  kairaApiUrl,
  kairaAuthToken,
  onUserIdChange,
  onApiUrlChange,
  onAuthTokenChange,
}: KairaApiConfigStepProps) {
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState<string | null>(null);

  const handleTestConnection = useCallback(async () => {
    if (!kairaApiUrl) return;

    setTestStatus('testing');
    setTestError(null);

    try {
      const url = kairaApiUrl.replace(/\/$/, '');
      const response = await fetch(`${url}/health`, {
        method: 'GET',
        headers: kairaAuthToken ? { Authorization: `Bearer ${kairaAuthToken}` } : {},
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        setTestStatus('success');
      } else {
        setTestStatus('error');
        setTestError(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (err) {
      setTestStatus('error');
      setTestError(err instanceof Error ? err.message : 'Connection failed');
    }
  }, [kairaApiUrl, kairaAuthToken]);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
          User ID
        </label>
        <Input
          value={userId}
          onChange={(e) => onUserIdChange(e.target.value)}
          placeholder="MyTatva user ID"
        />
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          The MyTatva user ID for Kaira conversations.
        </p>
      </div>

      <div>
        <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
          Kaira API URL <span className="text-[var(--color-error)]">*</span>
        </label>
        <Input
          value={kairaApiUrl}
          onChange={(e) => {
            onApiUrlChange(e.target.value);
            setTestStatus('idle');
          }}
          placeholder="https://kaira-api.example.com"
        />
      </div>

      <div>
        <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
          Auth Token
        </label>
        <Input
          type="password"
          value={kairaAuthToken}
          onChange={(e) => {
            onAuthTokenChange(e.target.value);
            setTestStatus('idle');
          }}
          placeholder="Bearer token for API authentication"
        />
      </div>

      {/* Test connection */}
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleTestConnection}
          disabled={!kairaApiUrl || testStatus === 'testing'}
          isLoading={testStatus === 'testing'}
          icon={Wifi}
        >
          Test Connection
        </Button>

        {testStatus === 'success' && (
          <span className="flex items-center gap-1.5 text-[13px] text-[var(--color-success)]">
            <CheckCircle2 className="h-4 w-4" />
            Connected
          </span>
        )}

        {testStatus === 'error' && (
          <span className="flex items-center gap-1.5 text-[13px] text-[var(--color-error)]">
            <AlertCircle className="h-4 w-4" />
            {testError || 'Failed'}
          </span>
        )}
      </div>

      {testStatus === 'error' && (
        <Alert variant="warning">
          Connection test failed, but you can still submit. The API may be intermittently unavailable.
        </Alert>
      )}
    </div>
  );
}
