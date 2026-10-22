/**
 * The GitHub issue a task was handed off to, stored in its `issue` frontmatter as the issue's URL.
 */

const ISSUE_URL_RE = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)$/;

/**
 * `owner/repo#N` for a GitHub issue URL, undefined for anything else.
 */
export const issueLabel = (url: string): string | undefined => {
  const match = url.match(ISSUE_URL_RE);
  return match ? `${match[1]}#${match[2]}` : undefined;
};
