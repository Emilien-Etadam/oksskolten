import { useState, useCallback, useEffect } from 'react'
import useSWR from 'swr'
import { useI18n } from '../../../lib/i18n'
import { fetcher, apiPatch } from '../../../lib/fetcher'
import { RadioGroup } from '@/components/ui/radio-group'

interface Preferences {
  'videos.enabled': string | null
  'videos.max_size_mb': string | null
  'videos.max_height': string | null
}

const DEFAULT_MAX_SIZE_MB = 500
const DEFAULT_MAX_HEIGHT = 720

export function VideoArchiveSection() {
  const { t } = useI18n()
  const { data: prefs, mutate: mutatePrefs } = useSWR<Preferences>('/api/settings/preferences', fetcher)
  const enabled = prefs?.['videos.enabled'] === 'on'
  const serverMaxSize = Number(prefs?.['videos.max_size_mb']) || DEFAULT_MAX_SIZE_MB
  const serverMaxHeight = Number(prefs?.['videos.max_height']) || DEFAULT_MAX_HEIGHT

  const [localMaxSize, setLocalMaxSize] = useState(String(serverMaxSize))
  const [localMaxHeight, setLocalMaxHeight] = useState(String(serverMaxHeight))

  useEffect(() => { setLocalMaxSize(String(serverMaxSize)) }, [serverMaxSize])
  useEffect(() => { setLocalMaxHeight(String(serverMaxHeight)) }, [serverMaxHeight])

  const savePref = useCallback(async (patch: Record<string, string>) => {
    await apiPatch('/api/settings/preferences', patch)
    void mutatePrefs()
  }, [mutatePrefs])

  const handleToggle = useCallback((value: 'on' | 'off') => {
    if (value === 'off') {
      void savePref({ 'videos.enabled': value })
      return
    }
    // Save the ceilings alongside, so the server never sees archiving enabled
    // without the limits that keep a download from filling the disk.
    void savePref({
      'videos.enabled': value,
      ...(prefs?.['videos.max_size_mb'] ? {} : { 'videos.max_size_mb': String(DEFAULT_MAX_SIZE_MB) }),
      ...(prefs?.['videos.max_height'] ? {} : { 'videos.max_height': String(DEFAULT_MAX_HEIGHT) }),
    })
  }, [savePref, prefs])

  const commitMaxSize = useCallback(() => {
    const num = Number(localMaxSize)
    if (!Number.isFinite(num) || num < 1) {
      setLocalMaxSize(String(serverMaxSize))
      return
    }
    if (num !== serverMaxSize) void savePref({ 'videos.max_size_mb': String(num) })
  }, [localMaxSize, serverMaxSize, savePref])

  const commitMaxHeight = useCallback(() => {
    const num = Number(localMaxHeight)
    if (!Number.isFinite(num) || num < 144) {
      setLocalMaxHeight(String(serverMaxHeight))
      return
    }
    if (num !== serverMaxHeight) void savePref({ 'videos.max_height': String(num) })
  }, [localMaxHeight, serverMaxHeight, savePref])

  const numberField = 'w-24 px-2 py-1 text-sm rounded-lg border border-border bg-bg-card text-text focus:outline-none focus:ring-1 focus:ring-accent'

  return (
    <section>
      <h2 className="text-base font-semibold text-text mb-1">{t('settings.videoArchive')}</h2>
      <p className="text-xs text-muted mb-4">{t('settings.videoArchiveDesc')}</p>

      <div>
        <p className="text-sm text-text mb-1">{t('settings.videoArchiveEnabled')}</p>
        <RadioGroup
          name="videoArchiveEnabled"
          options={[
            { value: 'on' as const, label: 'ON' },
            { value: 'off' as const, label: 'OFF' },
          ]}
          value={enabled ? 'on' : 'off'}
          onChange={handleToggle}
        />
      </div>

      {enabled && (
        <>
          <div className="mt-5">
            <p className="text-sm text-text mb-1">{t('settings.videoMaxHeight')}</p>
            <p className="text-xs text-muted mb-2">{t('settings.videoMaxHeightDesc')}</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={144}
                max={4320}
                value={localMaxHeight}
                onChange={(e) => setLocalMaxHeight(e.target.value)}
                onBlur={commitMaxHeight}
                onKeyDown={(e) => { if (e.key === 'Enter') commitMaxHeight() }}
                className={numberField}
              />
              <span className="text-sm text-muted">px</span>
            </div>
          </div>

          <div className="mt-5">
            <p className="text-sm text-text mb-1">{t('settings.videoMaxSize')}</p>
            <p className="text-xs text-muted mb-2">{t('settings.videoMaxSizeDesc')}</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={100000}
                value={localMaxSize}
                onChange={(e) => setLocalMaxSize(e.target.value)}
                onBlur={commitMaxSize}
                onKeyDown={(e) => { if (e.key === 'Enter') commitMaxSize() }}
                className={numberField}
              />
              <span className="text-sm text-muted">MB</span>
            </div>
          </div>

          <p className="mt-5 text-xs text-muted">{t('settings.videoArchiveRequirement')}</p>
        </>
      )}
    </section>
  )
}
