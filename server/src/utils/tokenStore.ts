const userTokens = new Map<string, any>();

export const tokenStore = {
  save(userId: string, token: any) {
    userTokens.set(userId, token);
  },
  get(userId: string) {
    return userTokens.get(userId);
  },
  delete(userId: string) {
    userTokens.delete(userId);
  }
};