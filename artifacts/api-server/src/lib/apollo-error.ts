/** Error from a lead data source (Apollo direct or Firecrawl). `status` is the HTTP status to send. */
export class ApolloError extends Error {
  constructor(
    message: string,
    public status: number,
    public planRestricted = false,
  ) {
    super(message);
  }
}
