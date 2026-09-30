/**
 * English and French words that say nothing about what a title is about.
 * Shared by the interest profile (its title terms) and similar-article
 * detection (the words two titles must have in common).
 *
 * Lowercase, accents kept: callers that fold accents fold this list too.
 */
export const STOPWORDS: ReadonlySet<string> = new Set(`
a about above after again against all also am an and any are as at be because been before being below between
both but by can could did do does doing down during each few for from further had has have having he her here
hers herself him himself his how i if in into is it its itself just let me more most my myself no nor not now of
off on once only or other our ours ourselves out over own same she should so some such than that the their theirs
them themselves then there these they this those through to too under until up very was we were what when where
which while who whom why will with would you your yours yourself yourselves new news says said year years one two
first last week today via how why what make made get gets got
au aux avec ce ces cet cette dans de des du elle elles en est et eux il ils je la le les leur leurs lui ma mais me
même mes moi mon ne nos notre nous on ont ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une
vos votre vous été être avoir fait faire plus sans sous chez vers entre comme aussi tout tous toute toutes après
avant bien encore déjà très peu ici là où dont cela ceci celui celle ceux celles quel quelle quels quelles ans
nouveau nouvelle nouveaux nouvelles selon contre depuis pendant comment pourquoi quand voici
`.split(/\s+/).filter(Boolean))
