"use client";

import { useEffect } from 'react';

export default function RetiredRecordingCleanup() {
  useEffect(() => {
    const prefixes = ['wolfgrid:conversation-merge:v1:', 'wolfgrid:conversation-split:v1:',
      'wolfgrid:field-application:v1:', 'wolfgrid:field-contact-preference:v1:', 'wolfgrid:deletion:v1:'];
    try {
      for (const key of Object.keys(localStorage)) {
        if (prefixes.some(prefix => key.startsWith(prefix))) localStorage.removeItem(key);
      }
    } catch { /* Retry when browser storage becomes available on a later visit. */ }
  }, []);
  return null;
}
