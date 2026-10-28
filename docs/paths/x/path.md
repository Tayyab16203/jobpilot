# X

```tree
follow: reached success

node home
  see: x.com/home
  branch reached | the search box, Latest | search

node search
  see: x.com/search with f=live
  branch reached | a hiring post in the results | status

node status
  see: x.com/{handle}/status/{id}
  branch reached | an apply link on the post | job
  branch reached | the reply control, when the post has no apply link and no email | reply

node reply
  see: the reply composer
  branch success | the note is on the post and the composer is empty | status
  branch retry | the composer is open and the note is still in it | reply

node job
  see: the page the post linked
  branch reached | a board page whose control opens the employer application | employer
  branch reached | an employer application on jobs.ashbyhq.com | application
  branch stop | a board page with no employer application | job

node employer
  see: the employer application, such as automattic.com/work-with-us/job/{slug}
  branch success | the page says the application was submitted | employer
  branch stop | a required field has no profile answer | employer

node application
  see: jobs.ashbyhq.com/{company}/{id}/application
  branch success | the page shows the application was submitted | application
  branch stop | a required field has no profile answer | application
```
