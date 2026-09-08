import { Separator } from '@/components/ui/separator'
import { ProfileSection } from './sections/profile-section'
import { ReadingSection } from './sections/reading-section'
import { LanguageSection } from './sections/language-section'
import { InterestsSection } from './sections/interests-section'

export function GeneralTab() {
  return (
    <>
      <ProfileSection />
      <LanguageSection />
      <Separator />
      <ReadingSection />
      <Separator />
      <InterestsSection />
    </>
  )
}
