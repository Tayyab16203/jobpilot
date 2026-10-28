# Instagram

```tree
follow: reached success

node home
  see: instagram.com/ and the signed-in profile
  branch reached | the search page | search
  branch reached | the inbox | inbox

node search
  see: instagram.com/explore/search/keyword
  branch reached | a hiring post from the last day | status
  branch stop | the visible posts are older than a day | search

node status
  see: instagram.com/p/{code}/
  branch reached | the comments under the post | comments
  branch reached | an apply link in the caption | job
  branch reached | the profile, when the caption points at the bio | bio
  branch reached | the inbox, when the post says to send a message | inbox
  branch stop | the role names an office city and does not say remote | status

node comments
  see: the comments under the post
  branch reached | an email or an apply link in a comment | job
  branch reached | the profile, when the comments name the bio | bio
  branch stop | the comments have no email, link, or instruction | comments

node bio
  see: the profile and the link in the bio
  branch reached | a link that opens an application | job
  branch stop | the bio has no application link | bio

node job
  see: the employer application the post linked
  branch stop | the page names an office city and does not say remote | job

node inbox
  see: instagram.com/direct/inbox/
  branch stop | the thread is a personal chat or a promotion | inbox
```
