"use client";

import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { onSession, pullData, pushData } from "@/lib/cloud";
import { t } from "@/lib/i18n";
import { type Data, normalizeData, withAutoBills } from "@/lib/store";

// Which account this device's local data belongs to, the cloud version it last matched,
// and whether there are local edits not yet uploaded.
const OWNER = "singil:syncOwner";
const VERSION = "singil:syncVersion";
const DIRTY = "singil:syncDirty";

export type SyncState = "off" | "syncing" | "ok" | "error";

/**
 * Keeps the landlord's local data in sync with Supabase while signed in.
 * Local-first: the app works offline; edits upload ~1s after they happen.
 */
export function useCloud(data: Data, replaceData: (d: Data) => void) {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<SyncState>("off");
  const [lastSync, setLastSync] = useState<string | null>(() => localStorage.getItem(VERSION));
  const userId = session?.user.id;
  const ready = useRef(false); // initial reconciliation finished for this user
  const skipPush = useRef(false); // data was just replaced from the cloud
  const dataRef = useRef(data);
  const lastSeen = useRef(data); // to tell real edits apart from re-renders / sign-in
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => onSession(setSession), []);

  const push = useCallback(async (d: Data) => {
    setState("syncing");
    try {
      const version = await pushData(d);
      localStorage.setItem(VERSION, version);
      localStorage.removeItem(DIRTY);
      setLastSync(version);
      setState("ok");
    } catch {
      setState("error");
    }
  }, []);

  /** Reconcile this device with the cloud: newest copy wins; ask only on a real conflict. */
  const reconcile = useCallback(
    async (uid: string) => {
      setState("syncing");
      try {
        const cloud = await pullData();
        const local = dataRef.current;
        const sameOwner = localStorage.getItem(OWNER) === uid;
        const dirty = localStorage.getItem(DIRTY) === "1";
        let useCloudData = false;

        if (!cloud) {
          useCloudData = false;
        } else if (sameOwner) {
          // Same instant can come back as "…Z" or "…+00:00", so compare as times.
          const changedElsewhere = Date.parse(cloud.updatedAt) !== Date.parse(localStorage.getItem(VERSION) ?? "");
          useCloudData = changedElsewhere && (!dirty || confirm(t().chooseData(cloud.data.units.length, local.units.length)));
        } else if (local.units.length === 0) {
          useCloudData = true;
        } else if (cloud.data.units.length > 0) {
          useCloudData = confirm(t().chooseData(cloud.data.units.length, local.units.length));
        }

        localStorage.setItem(OWNER, uid);
        let needPush = true;
        if (useCloudData && cloud) {
          const next = withAutoBills(normalizeData(cloud.data));
          skipPush.current = true; // don't echo the data we just downloaded back up
          replaceData(next);
          dataRef.current = next;
          localStorage.setItem(VERSION, cloud.updatedAt);
          localStorage.removeItem(DIRTY);
          setLastSync(cloud.updatedAt);
          setState("ok");
          // Only upload again if this device added something (e.g. automatic bills).
          needPush = JSON.stringify(next.bills) !== JSON.stringify(cloud.data.bills);
        }
        // From here on, edits upload normally. Edits made while we were syncing were
        // marked dirty by the upload effect, so push the latest data if there are any.
        ready.current = true;
        if (needPush || localStorage.getItem(DIRTY) === "1") await push(dataRef.current);
      } catch {
        ready.current = true;
        setState("error");
      }
    },
    [push, replaceData],
  );

  // First sync after sign-in (or app start while signed in).
  useEffect(() => {
    ready.current = false;
    if (!userId) return;
    const timer = setTimeout(() => reconcile(userId), 0);
    return () => clearTimeout(timer);
  }, [userId, reconcile]);

  // Upload edits shortly after they happen.
  useEffect(() => {
    const edited = data !== lastSeen.current;
    lastSeen.current = data;
    if (!edited) return;
    if (skipPush.current) {
      skipPush.current = false; // this change came from the cloud
      return;
    }
    // Remember unsynced edits even while signed out or offline, so the next sync keeps them.
    localStorage.setItem(DIRTY, "1");
    // Not signed in, or still reconciling — reconcile() uploads dirty data when it runs.
    if (!userId || !ready.current) return;
    const timer = setTimeout(() => push(data), 1000);
    return () => clearTimeout(timer);
  }, [data, userId, push]);

  useEffect(() => {
    if (!userId) return;
    // Pick up changes made on another device when the app comes back to the foreground.
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (localStorage.getItem(DIRTY) !== "1") reconcile(userId);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [userId, reconcile]);

  return {
    session,
    syncState: userId ? state : ("off" as SyncState),
    lastSync,
    syncNow: () => userId && reconcile(userId),
  };
}
