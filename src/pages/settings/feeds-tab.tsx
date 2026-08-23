import { Separator } from '@/components/ui/separator'
import { FeedDiagnosticsSection } from './sections/feed-diagnostics-section'
import { FeedManagementSection } from './sections/feed-management-section'

export function FeedsTab() {
  return (
    <>
      <FeedDiagnosticsSection />
      <Separator />
      <FeedManagementSection />
    </>
  )
}
