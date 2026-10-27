import { createContext, useContext } from 'react';
import type { Repo } from './types';

export const RepoContext = createContext<Repo | null>(null);

export function useRepo(): Repo {
  const r = useContext(RepoContext);
  if (!r) throw new Error('RepoContext 가 없습니다.');
  return r;
}
