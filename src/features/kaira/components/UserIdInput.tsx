/**
 * User ID Input Component
 * Initial setup screen for entering Kaira user ID
 */

import { useState, useCallback } from 'react';
import { User, ArrowRight } from 'lucide-react';
import { Button, Input } from '@/components/ui';

interface UserIdInputProps {
  onSubmit: (userId: string) => void;
  initialUserId?: string;
}

export function UserIdInput({ onSubmit, initialUserId = '' }: UserIdInputProps) {
  const [userId, setUserId] = useState(initialUserId);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    
    const trimmed = userId.trim();
    if (!trimmed) {
      setError('Please enter a user ID');
      return;
    }
    
    // Basic validation - alphanumeric with underscores/dashes
    if (!/^[\w-]+$/.test(trimmed)) {
      setError('User ID can only contain letters, numbers, underscores, and dashes');
      return;
    }
    
    setError(null);
    onSubmit(trimmed);
  }, [userId, onSubmit]);

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">
        {/* Icon */}
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-brand-accent)]/10">
            <User className="h-8 w-8 text-[var(--text-brand)]" />
          </div>
        </div>

        {/* Title */}
        <div className="text-center">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">
            Welcome to Kaira Chat
          </h2>
          <p className="mt-2 text-[14px] text-[var(--text-secondary)]">
            Enter your user ID to start chatting with Kaira
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label 
              htmlFor="userId" 
              className="block text-[13px] font-medium text-[var(--text-primary)] mb-2"
            >
              User ID
            </label>
            <Input
              id="userId"
              type="text"
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                setError(null);
              }}
              placeholder="e.g., test_user_001"
              error={error ?? undefined}
              icon={<User className="h-4 w-4" />}
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            className="w-full gap-2"
          >
            Start Chatting
            <ArrowRight className="h-4 w-4" />
          </Button>
        </form>

        {/* Help text */}
        <p className="text-center text-[12px] text-[var(--text-muted)]">
          This ID will be used to identify you in the Kaira API.
          <br />
          Your chats will be saved locally on this device.
        </p>
      </div>
    </div>
  );
}
