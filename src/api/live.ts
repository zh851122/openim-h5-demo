import request from '@utils/request'
import { getChatToken } from '@/utils/storage'

export type LiveConfig = {
  pushDomain: string
  playDomain: string
  appName: string
  expireSeconds: number
}

export type LiveMemberPreview = {
  userID: string
  nickname?: string
  faceURL?: string
}

export type LiveRoomItem = {
  id: string
  name: string
  streamName: string
  remark?: string
  createTime?: number
  updateTime?: number
  groupID?: string
  imGroupID?: string
  onlineCount?: number
  onlineMemberCount?: number
  onlineUserCount?: number
  onlineMembers?: LiveMemberPreview[]
}

export type ListLiveRoomResp = {
  total: number
  list: LiveRoomItem[]
}

export type LiveRoomUrls = {
  expiresAtUnix: number
  pushUrl: string
  obsServer: string
  obsStreamKey: string
  playRtmpUrl: string
  playFlvUrl: string
  playHlsUrl: string
}

const getHeaders = () => ({
  headers: {
    token: getChatToken(),
  },
})

const postWithFallback = async <TResp, TReq>(
  paths: string[],
  req: TReq,
): Promise<{ errCode: number; errMsg?: string; data: TResp }> => {
  let lastError: unknown
  for (const path of paths) {
    try {
      return await request.post(path, JSON.stringify(req), getHeaders())
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

export const listLiveRooms = (req: {
  keyword: string
  pagination: { pageNumber: number; showNumber: number }
}) =>
  postWithFallback<ListLiveRoomResp, typeof req>(
    ['/live/room/list', '/live/user/room/list'],
    req,
  )

export const getLiveRoomUrls = (req: { id: string; expireSeconds: number }) =>
  postWithFallback<LiveRoomUrls, typeof req>(
    ['/live/room/urls', '/live/user/room/urls'],
    req,
  )

export const getLiveConfig = () =>
  postWithFallback<LiveConfig, Record<string, never>>(
    ['/live/config', '/live/user/config'],
    {},
  )
