export async function authRequest(endpoint, { body, signal } = {}) {
  const method = endpoint === "me" ? "GET" : "POST";

  const response = await fetch("/api/auth/" + endpoint, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: method === "POST" ? {
      "Content-Type": "application/json",
      "X-Requested-With": "EventBooking",
    } : {},
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || data?.success !== true) {
    throw new Error(data?.message || "Request failed. Please try again.");
  }

  if (endpoint !== "logout") {
    const user = data.user;
    const validUser = user &&
      typeof user._id === "string" &&
      typeof user.name === "string" &&
      typeof user.email === "string" &&
      ["USER", "ADMIN"].includes(user.role);

    if (!(endpoint === "me" && user === null) && !validUser) {
      throw new Error("Unexpected login response. Refresh the page to check.");
    }
  }

  return data;
}
