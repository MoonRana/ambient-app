import React, { useEffect, useRef, useState } from 'react';
import AIConsentModal from '@/components/AIConsentModal';
import {
  registerAIConsentModal,
  unregisterAIConsentModal,
} from '@/lib/ai-consent';

export function AIConsentProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const resolverRef = useRef<((granted: boolean) => void) | null>(null);

  useEffect(() => {
    registerAIConsentModal((pending) => {
      resolverRef.current = pending.resolve;
      setVisible(true);
    });
    return () => unregisterAIConsentModal();
  }, []);

  const finish = (granted: boolean) => {
    setVisible(false);
    resolverRef.current?.(granted);
    resolverRef.current = null;
  };

  return (
    <>
      {children}
      <AIConsentModal
        visible={visible}
        onAgree={() => finish(true)}
        onDecline={() => finish(false)}
      />
    </>
  );
}
