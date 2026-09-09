import { useState, useEffect, useRef } from 'react'
import useSWR from 'swr'
import { useI18n } from '@/i18n'
import { fetcher, apiPatch } from '../../../lib/fetcher'
import { AvatarPicker } from '../../../components/settings/avatar-picker'
import { Input } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'

export function ProfileSection() {
  const { t } = useI18n()
  const { data: profile, mutate: mutateProfile } = useSWR<{ account_name: string; avatar_seed: string | null }>('/api/settings/profile', fetcher)
  const [editName, setEditName] = useState('')
  const [editAvatarSeed, setEditAvatarSeed] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const initialized = useRef(false)

  useEffect(() => {
    if (profile && !initialized.current) {
      setEditName(profile.account_name)
      setEditAvatarSeed(profile.avatar_seed ?? null)
      initialized.current = true
    }
  }, [profile])

  const isDirty = editName.trim() !== (profile?.account_name ?? '') ||
    (editAvatarSeed ?? '') !== (profile?.avatar_seed ?? '')

  function handleCancel() {
    setEditName(profile?.account_name ?? '')
    setEditAvatarSeed(profile?.avatar_seed ?? null)
  }

  async function handleSave() {
    const trimmed = editName.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      const newData = await apiPatch('/api/settings/profile', {
        account_name: trimmed,
        avatar_seed: editAvatarSeed,
      }) as { account_name: string; avatar_seed: string | null }
      void mutateProfile(newData, { revalidate: false })
    } catch {
      // keep draft on failure
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <h2 className="text-base font-semibold text-text mb-4">{t('settings.profile')}</h2>
      <FormField label={t('settings.accountName')} hint={t('settings.accountNameHint')} compact>
      <div className="flex items-center gap-3">
        <AvatarPicker
          name={editName || profile?.account_name || '?'}
          currentSeed={editAvatarSeed}
          onSelect={setEditAvatarSeed}
          sizeClass="w-12 h-12"
          textClass="text-lg"
        />
        <Input
          type="text"
          value={editName}
          onChange={e => setEditName(e.target.value)}
          disabled={saving}
          className="flex-1"
        />
      </div>
      </FormField>
      {isDirty && (
        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={handleCancel}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded-lg border border-border text-text hover:bg-hover transition-colors"
          >
            {t('settings.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !editName.trim()}
            className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? t('settings.saving') : t('settings.save')}
          </button>
        </div>
      )}
    </section>
  )
}
