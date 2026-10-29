# Deploy the Event Booking demo

Use the existing MongoDB Atlas database and one Render web service. Express serves
`client/dist` and `/api` on the same HTTPS origin, so the existing relative API
requests and SameSite=Lax session cookies work without cross-origin configuration.

This file describes setup and verification. It is not a claim that a live
deployment has already passed these checks.

## 1. Push the hosting update

From the repository root, run the checks and frontend build:

```bash
node checks/access-check.mjs
node checks/hosting-check.mjs
npm --prefix client run build
```

Commit the hosting changes and push `main` to
`https://github.com/Akhil0978/event-booking-waitlist`.
Keep the actual `.env` file out of Git.

## 2. Create a Render Blueprint

Sign in at [Render](https://dashboard.render.com/) and create a new Blueprint from
the GitHub repository. Connect only the repository you intend to deploy, and use
the `main` branch and its `render.yaml` file. Review the service before creation:

| Setting | Value |
|---|---|
| Service | Web service, Node |
| Name | `event-booking-waitlist` (Render assigns the final hostname) |
| Compute plan | Free |
| Root directory | Repository root; leave blank |
| Node | 24.22.1 |
| Start command | `npm --prefix server start` |
| Health check | `/api/health` |
| Auto-deploy | Off; manually deploy later updates |

The Blueprint supplies the build command, `NODE_ENV=production`,
`TRUST_PROXY_HOPS=1`, and a newly generated `SESSION_SECRET`.
Enter your MongoDB connection string as `MONGODB_URI` **in Render's secret form**.
Do not put it in the YAML, GitHub, a screenshot or a chat message.

`APP_ORIGINS` defaults to Render's supplied `RENDER_EXTERNAL_URL`. No hostname
needs to be guessed in advance. For a custom domain, set `APP_ORIGINS` to the
exact allowed HTTPS origins, separated by commas. No paths or wildcards.

If you reuse your local MongoDB URI, the live app shares the existing
`event_booking` database with local development. This update does not change or
delete database records. Render uses its own session secret.

## 3. Allow the service to reach Atlas

On the Render service page, open **Connect > Outbound**. Add all the listed CIDR
ranges to the Atlas project's Network Access IP access list. Keep your existing
development-machine entry if you still run the app locally.

Use the service's actual ranges rather than guessing addresses. After Atlas has
applied the entries, retry the deploy if the first attempt failed to connect.
Do not copy the local `DNS_SERVERS` setting unless the hosting environment needs it.

## 4. Verify the live app

1. Open the service's actual HTTPS URL. Check that the event page and styles load.
2. Open `/api/health` on that URL. It should return a JSON success response.
3. Sign up with a test account, refresh, and confirm the account stays signed in.
4. Book a seat, refresh, then log out. Confirm private bookings require login.
5. Sign in to the existing admin account, create a future one-seat test event,
   fill it with one user, and join its waitlist with a second user.
6. Cancel the confirmed booking. Verify the waiting user becomes confirmed and
   the result survives refresh. Confirm each regular user sees only their bookings.

Do not publish admin credentials. Add the live URL to the README/resume after
these checks pass. The included automated checks use in-memory users/models and
sessions; they do not verify Atlas transactions, real proxy routing or the browser
on the deployed service.

## Updating and troubleshooting

- After pushing a later commit, use Render's manual deploy for the latest commit.
- A missing frontend build stops startup with a clear error. The build command
  must run from the repository root and include the client build.
- A database connection error usually needs the correct Atlas credentials and
  the service's outbound ranges on the Atlas access list.
- For login problems, check the exact allowed HTTPS origin and proxy setting.
  `TRUST_PROXY_HOPS=1` is the intended Render setting; do not copy it to a different
  network topology without checking its proxy path. Direct local development uses 0.
- Free Render web services currently sleep after 15 minutes without traffic and
  can take about a minute to wake. Free usage limits also apply. Review the plan
  and limits before enabling paid compute or adding a payment method.

## References

- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
- [Render web services](https://render.com/docs/web-services)
- [Render environment variables](https://render.com/docs/environment-variables)
- [Render outbound IP ranges](https://render.com/docs/outbound-ip-addresses)
- [Render free-service limits](https://render.com/docs/free)
- [Express behind proxies](https://expressjs.com/en/guide/behind-proxies/)
- [Express session cookies](https://expressjs.com/en/resources/middleware/session/)

Hosting documentation checked on 29 October 2026.
