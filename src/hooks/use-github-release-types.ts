import { createLocalStorageHook } from './create-local-storage-hook'

/** Mirrors ReleaseTypes in server/fetcher/github-releases.ts. */
export type GithubReleaseTypes = 'stable' | 'prerelease' | 'tags'

export const GITHUB_RELEASE_TYPE_VALUES: GithubReleaseTypes[] = ['stable', 'prerelease', 'tags']

const useHook = createLocalStorageHook<GithubReleaseTypes>(
  'github-release-types',
  'stable',
  GITHUB_RELEASE_TYPE_VALUES,
)

export function useGithubReleaseTypes() {
  const [githubReleaseTypes, setGithubReleaseTypes] = useHook()
  return { githubReleaseTypes, setGithubReleaseTypes }
}
