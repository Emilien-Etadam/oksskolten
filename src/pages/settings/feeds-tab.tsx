import { Separator } from '@/components/ui/separator'
import { FeedDiagnosticsSection } from './sections/feed-diagnostics-section'
import { FeedManagementSection } from './sections/feed-management-section'
import { RulesSection } from './sections/rules-section'

export function FeedsTab() {
  return (
    <>
      <FeedDiagnosticsSection />
      <Separator />
      <FeedManagementSection />
      <Separator />
      <RulesSection />
    </>
  )
}
