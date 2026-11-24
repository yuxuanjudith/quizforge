import { useQuery } from 'deepspace'
import type { GameRow, PlayerRow } from '../../lib/game-types'

/**
 * Live view of one game: the `games` row plus its players, both pushed over
 * the record room's WebSocket whenever a server action changes them. This is
 * the whole "realtime" layer — no polling, no custom socket code.
 */
export function useGame(gameId: string) {
  const games = useQuery<GameRow>('games', { where: { recordId: gameId }, limit: 1 })
  const players = useQuery<PlayerRow>('players', { where: { gameId } })
  const game = games.records[0]
  return {
    game: game?.data,
    gameStatus: games.status,
    notFound: games.status === 'ready' && !game,
    players: players.records.map((r) => r.data),
  }
}
