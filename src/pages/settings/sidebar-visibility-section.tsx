import { useI18n } from '../../lib/i18n'
import { useAppLayout } from '../../app'
import { RadioGroup } from '@/components/ui/radio-group'
import { MD_BREAKPOINT } from '../../lib/breakpoints'
import { useHideSidebar, type HideSidebar } from '../../hooks/use-hide-sidebar'

/**
 * Toggle for newspaper-style navigation: hide the sidebar and rely on the
 * bottom tab bar instead. The Menu tab still opens the sidebar on demand.
 */
export function SidebarVisibilitySection() {
  const { setSidebarOpen } = useAppLayout()
  const { hideSidebar, setHideSidebar } = useHideSidebar()
  const { t } = useI18n()

  const handleChange = (value: HideSidebar) => {
    setHideSidebar(value)
    setSidebarOpen(value === 'off' && window.matchMedia(`(min-width: ${MD_BREAKPOINT}px)`).matches)
  }

  return (
    <section>
      <h2 className="text-base font-semibold text-text mb-1">{t('settings.hideSidebar')}</h2>
      <p className="text-xs text-muted mb-3">{t('settings.hideSidebarDesc')}</p>
      <RadioGroup
        name="hideSidebar"
        options={[
          { value: 'off' as const, label: t('settings.hideSidebarOff') },
          { value: 'on' as const, label: t('settings.hideSidebarOn') },
        ]}
        value={hideSidebar}
        onChange={handleChange}
      />
    </section>
  )
}
