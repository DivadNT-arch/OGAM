import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** One timed editor operation, shown on the Edit timing screen. */
interface TimingEntry {
  id: string;
  at: string;
  operation: string;
  durationMs: number;
  detail?: string;
  failed?: boolean;
}

interface TimingLogState {
  entries: TimingEntry[];
  clear: () => void;
}

const MAX_ENTRIES = 300;

export const useTimingLog = create<TimingLogState>()(
  persist(
    set => ({ entries: [], clear: () => set({ entries: [] }) }),
    { name: 'photo-editor-timing-log', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

function recordTiming(t: { operation: string; durationMs: number; detail?: string; failed?: boolean }): void {
  const entry: TimingEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    operation: t.operation,
    durationMs: Math.round(t.durationMs),
    detail: t.detail,
    failed: t.failed ?? false,
  };
  useTimingLog.setState(s => ({ entries: [entry, ...s.entries].slice(0, MAX_ENTRIES) }));
}

/** Runs an async operation and logs how long it took, including failures. */
export async function timed<T>(operation: string, run: () => Promise<T>, detail?: (r: T) => string): Promise<T> {
  const started = Date.now();
  try {
    const result = await run();
    recordTiming({ operation, durationMs: Date.now() - started, detail: detail?.(result) });
    return result;
  } catch (error: any) {
    recordTiming({ operation, durationMs: Date.now() - started, detail: error?.message ?? String(error), failed: true });
    throw error;
  }
}
