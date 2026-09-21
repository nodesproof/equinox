// useSyncStatus.ts — satu hook untuk status sinkronisasi (connecting | failed | live | stale) dari ChainState + jam useNow():
// dipakai kartu jaringan sidebar dan badge topbar agar keduanya selalu sepakat dan rumusnya tidak diduplikasi (`syncStatus` murni di lib/sync.ts).
import { useChain } from '@/chain/provider';
import { useNow } from '@/chain/clock';
import { syncStatus, type SyncStatus } from '@/lib/sync';

export function useSyncStatus(): SyncStatus {
  const { snapshot, meta } = useChain();
  return syncStatus({ snapshot, meta }, useNow());
}
