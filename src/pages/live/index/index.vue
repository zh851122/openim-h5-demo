<template>
  <div class="live_page">
    <div v-if="loading" class="state_wrap">
      <van-loading size="24px" vertical>Loading live rooms...</van-loading>
    </div>

    <div v-else-if="rooms.length === 0" class="state_wrap">
      <span>No live room</span>
    </div>

    <div
      v-else
      class="live_swiper"
      @wheel.prevent="handleWheel"
      @touchstart.passive="handleTouchStart"
      @touchend.passive="handleTouchEnd"
    >
      <div class="live_track" :style="trackStyle">
        <section v-for="(room, index) in rooms" :key="room.id" class="live_room">
          <video
            v-if="index === activeIndex && room.playHlsUrl"
            class="live_video"
            src="https://1252662993.vod-qcloud.com/2bb67457vodtranscq1252662993/6689eee35145403715138416767/adp.10.m3u8"
            autoplay
            controls
            playsinline
            webkit-playsinline
            x5-playsinline
          />
          <div v-else class="live_placeholder">
            <div class="placeholder_text">
              <span>{{ room.name || 'Live Room' }}</span>
              <span class="mt-2 text-xs text-[#9FA8B9]">
                {{ room.playHlsUrl ? 'Swipe up/down to switch room' : 'Stream unavailable' }}
              </span>
            </div>
          </div>
        </section>
      </div>

      <div class="live_overlay">
        <div class="room_head">
          <div class="room_title">{{ currentRoom?.name || 'Live Room' }}</div>
          <div class="room_subtitle">{{ currentRoom?.remark || 'Swipe up/down to switch room' }}</div>
        </div>

        <div class="room_metrics">
          <button class="metric_chip metric_chip_btn" @click="openOnlineMembers">
            Online {{ currentOnlineCount }}
          </button>
          <div class="metric_chip">{{ activeIndex + 1 }}/{{ rooms.length }}</div>
        </div>

        <div class="chat_panel" :style="chatPanelStyle">
          <div class="chat_list" ref="chatListRef">
            <div v-for="message in liveMessages" :key="message.id" class="chat_item">
              <span class="chat_name">{{ message.nickname }}:</span>
              <span class="chat_text">{{ message.text }}</span>
            </div>
          </div>
          <div class="chat_input_row">
            <input
              v-model="chatInput"
              class="chat_input"
              :disabled="sendingMessage"
              placeholder="Say something..."
              @keydown.enter.prevent="sendPublicMessage"
              @focus="handleChatInputFocus"
              @blur="handleChatInputBlur"
            />
            <button
              class="chat_send"
              :disabled="!chatInput.trim() || !currentRoomGroupID || sendingMessage"
              @click="sendPublicMessage"
            >
              Send
            </button>
          </div>
        </div>
      </div>

      <van-popup
        v-model:show="onlineMembersVisible"
        round
        position="bottom"
        :style="{ height: '58%' }"
        @open="loadCurrentRoomOnlineMembers"
        @close="handleOnlineMembersClose"
      >
        <div class="online_popup">
          <div class="online_popup_head">
            <span>Online Users</span>
            <span class="online_popup_count">{{ currentOnlineCount }}</span>
          </div>
          <div v-if="onlineMembersLoading" class="online_popup_state">
            <van-loading size="20px" vertical>Loading...</van-loading>
          </div>
          <div v-else-if="currentOnlineMembers.length === 0" class="online_popup_state">
            No online users
          </div>
          <div v-else class="online_member_list">
            <div v-for="member in currentOnlineMembers" :key="member.userID" class="online_member_item">
              <Avatar
                :size="34"
                :radius="17"
                :src="member.faceURL"
                :desc="member.nickname || member.userID"
              />
              <div class="online_member_name">{{ member.nickname || member.userID }}</div>
            </div>
          </div>
        </div>
      </van-popup>
    </div>
  </div>
</template>

<script name="live" setup lang="ts">
import Avatar from '@/components/Avatar/index.vue'
import {
  getLiveConfig,
  getLiveRoomUrls,
  listLiveRooms,
  type LiveMemberPreview,
  type LiveRoomItem,
  type LiveRoomUrls,
} from '@/api/live'
import { feedbackToast } from '@/utils/common'
import { IMSDK } from '@/utils/imCommon'
import { getIMUserID } from '@/utils/storage'
import {
  CbEvents,
  GroupJoinSource,
  MessageType,
  OnlineState,
  SessionType,
  ViewType,
} from '@openim/wasm-client-sdk'
import type {
  GroupMemberItem,
  MessageItem,
  UserOnlineState,
  WSEvent,
} from '@openim/wasm-client-sdk/lib/types/entity'

type LiveRoomView = LiveRoomItem &
  Partial<LiveRoomUrls> & {
    urlLoading?: boolean
  }

type RoomPresenceState = {
  groupID: string
  joined: boolean
  loading: boolean
  memberCount: number
  members: GroupMemberItem[]
  onlineCount: number
  onlineMembers: LiveMemberPreview[]
}

type PublicMessage = {
  id: string
  userID: string
  nickname: string
  text: string
  sendTime: number
}

const MEMBER_PAGE_SIZE = 500
const MAX_MEMBER_FETCH = 5000
const STATUS_BATCH_SIZE = 200
const JOINED_GROUP_PAGE_SIZE = 200
const WHEEL_TRIGGER = 20
const TOUCH_TRIGGER = 60
const SWITCH_INTERVAL = 280
const MAX_PUBLIC_MESSAGES = 60
const PUBLIC_MESSAGE_FLUSH_MS = 48

const loading = ref(false)
const expireSeconds = ref(3600)
const rooms = ref<LiveRoomView[]>([])
const activeIndex = ref(0)
const transitionLock = ref(false)
const startY = ref(0)

const roomPresenceMap = reactive<Record<string, RoomPresenceState>>({})
const userStatusMap = reactive<Record<string, OnlineState>>({})
const subscribedUserIDs = ref<string[]>([])
const syncingPresence = ref(false)

const liveMessages = ref<PublicMessage[]>([])
const messageSeenMap = reactive<Record<string, boolean>>({})
const chatInput = ref('')
const sendingMessage = ref(false)
const chatListRef = ref<HTMLDivElement>()
const chatInputFocused = ref(false)
const keyboardInset = ref(0)
const onlineMembersVisible = ref(false)
const onlineMembersLoading = ref(false)
const roomChangeToken = ref(0)
let chatAutoScrollRaf = 0
const pendingPublicMessages: PublicMessage[] = []

let refreshTimer: ReturnType<typeof setTimeout> | undefined
let publicMessageFlushTimer: ReturnType<typeof setTimeout> | undefined

const trackStyle = computed(() => ({
  transform: `translate3d(0, -${activeIndex.value * 100}%, 0)`,
}))

const currentRoom = computed(() => rooms.value[activeIndex.value])
const selfUserID = computed(() => getIMUserID() || '')

const currentRoomGroupID = computed(() => resolveRoomGroupID(currentRoom.value))

const currentPresenceState = computed(() => {
  const room = currentRoom.value
  if (!room) return undefined
  return roomPresenceMap[room.id]
})

const currentOnlineMembers = computed(() => {
  return currentPresenceState.value?.onlineMembers ?? []
})

const currentOnlineCount = computed(() => {
  const room = currentRoom.value
  if (!room) return 0
  const state = roomPresenceMap[room.id]
  if (state) return state.onlineCount
  return getBackendOnlineCount(room) ?? 0
})

const chatPanelStyle = computed(() => ({
  marginBottom: `${keyboardInset.value}px`,
}))

const toNumber = (value: unknown) => {
  const result = Number(value)
  if (!Number.isFinite(result)) return undefined
  return result
}

const ensurePresenceState = (roomID: string, groupID: string): RoomPresenceState => {
  if (!roomPresenceMap[roomID]) {
    roomPresenceMap[roomID] = {
      groupID,
      joined: false,
      loading: false,
      memberCount: 0,
      members: [],
      onlineCount: 0,
      onlineMembers: [],
    }
  }
  return roomPresenceMap[roomID]
}

const getBackendOnlineCount = (room?: LiveRoomView) => {
  if (!room) return undefined
  const candidateKeys = ['onlineCount', 'onlineMemberCount', 'onlineUserCount']
  for (const key of candidateKeys) {
    const parsed = toNumber((room as Record<string, unknown>)[key])
    if (parsed !== undefined) return parsed
  }
  return undefined
}

const getBackendOnlineMembers = (room?: LiveRoomView): LiveMemberPreview[] => {
  if (!room || !Array.isArray(room.onlineMembers)) return []
  return room.onlineMembers
    .map((member) => {
      if (typeof member === 'string') {
        return {
          userID: member,
          nickname: member,
        }
      }
      return {
        userID: member.userID,
        nickname: member.nickname,
        faceURL: member.faceURL,
      }
    })
    .filter((member) => !!member.userID)
}

const resolveRoomGroupID = (room?: LiveRoomView) => {
  if (!room) return ''
  const source = room as Record<string, unknown>
  const candidates = [
    room.groupID,
    room.imGroupID,
    source.imGroupId,
    source.liveGroupID,
    source.chatGroupID,
    source.groupId,
    source.streamGroupID,
    source.imStreamGroupID,
    room.streamName,
  ]
  return (candidates.find((item) => typeof item === 'string' && item.length > 0) as string) || ''
}

const splitBatch = (source: string[], size: number) => {
  const result: string[][] = []
  for (let index = 0; index < source.length; index += size) {
    result.push(source.slice(index, index + size))
  }
  return result
}

const applyUserStatus = (statusList: UserOnlineState[]) => {
  statusList.forEach((item) => {
    userStatusMap[item.userID] = item.status
  })
}

const clearStatusSubscribe = async () => {
  if (subscribedUserIDs.value.length === 0) return
  const batches = splitBatch(subscribedUserIDs.value, STATUS_BATCH_SIZE)
  for (const userIDs of batches) {
    try {
      await IMSDK.unsubscribeUsersStatus(userIDs)
    } catch (error) {
      console.warn('unsubscribeUsersStatus failed', error)
    }
  }
  subscribedUserIDs.value = []
}

const subscribeStatus = async (userIDs: string[]) => {
  await clearStatusSubscribe()
  if (userIDs.length === 0) return

  const uniqueUserIDs = Array.from(new Set(userIDs.filter(Boolean)))
  const batches = splitBatch(uniqueUserIDs, STATUS_BATCH_SIZE)

  for (const ids of batches) {
    try {
      const { data } = await IMSDK.subscribeUsersStatus(ids)
      applyUserStatus(data)
    } catch (error) {
      console.warn('subscribeUsersStatus failed', error)
    }
  }
  subscribedUserIDs.value = uniqueUserIDs
}

const getAllGroupMembers = async (groupID: string) => {
  let offset = 0
  const members: GroupMemberItem[] = []

  while (offset < MAX_MEMBER_FETCH) {
    const { data } = await IMSDK.getGroupMemberList({
      groupID,
      offset,
      count: MEMBER_PAGE_SIZE,
      filter: 0,
    })
    members.push(...data)
    if (data.length < MEMBER_PAGE_SIZE) break
    offset += MEMBER_PAGE_SIZE
  }
  return members
}

const updateRoomOnlineState = (room: LiveRoomView) => {
  const state = roomPresenceMap[room.id]
  if (!state) return

  if (state.members.length > 0) {
    state.onlineMembers = state.members
      .filter((member) => userStatusMap[member.userID] === OnlineState.Online)
      .map((member) => ({
        userID: member.userID,
        nickname: member.nickname,
        faceURL: member.faceURL,
      }))
  } else {
    state.onlineMembers = getBackendOnlineMembers(room)
  }

  const backendOnlineCount = getBackendOnlineCount(room)
  state.onlineCount = backendOnlineCount ?? state.onlineMembers.length
  state.memberCount = Math.max(state.memberCount, state.members.length)
}

const parseErrCode = (error: unknown) => {
  const candidate = error as Record<string, any>
  const value = Number(candidate?.errCode ?? candidate?.data?.errCode)
  return Number.isFinite(value) ? value : 0
}

const getRoomByIndex = (index: number) => {
  if (index < 0 || index >= rooms.value.length) return undefined
  return rooms.value[index]
}

const leaveRoomPresence = async (room?: LiveRoomView) => {
  if (!room) return
  const state = roomPresenceMap[room.id]
  if (!state) return
  state.groupID = resolveRoomGroupID(room)
}

const isCurrentUserInJoinedGroupList = async (groupID: string) => {
  if (!groupID) return false
  let offset = 0
  while (offset < MAX_MEMBER_FETCH) {
    try {
      const { data } = await IMSDK.getJoinedGroupListPage({
        offset,
        count: JOINED_GROUP_PAGE_SIZE,
      })
      if (data.some((item) => item.groupID === groupID)) return true
      if (data.length < JOINED_GROUP_PAGE_SIZE) break
      offset += JOINED_GROUP_PAGE_SIZE
    } catch (error) {
      console.warn('getJoinedGroupListPage failed', error)
      return false
    }
  }
  return false
}

const ensureJoinedGroup = async (groupID: string, state?: RoomPresenceState) => {
  if (!groupID) return false
  if (state?.joined) return true

  let joined = false
  try {
    await IMSDK.joinGroup({
      groupID,
      reqMsg: '',
      joinSource: GroupJoinSource.Search,
    })
    joined = true
  } catch (error) {
    console.warn('joinGroup failed', error)
    joined = await isCurrentUserInJoinedGroupList(groupID)
  }

  if (state) {
    state.joined = joined
  }
  return joined
}

const syncActiveRoomPresence = async () => {
  const room = currentRoom.value
  if (!room || syncingPresence.value) return

  syncingPresence.value = true
  const groupID = resolveRoomGroupID(room)
  const state = ensurePresenceState(room.id, groupID)
  state.groupID = groupID
  state.loading = true

  try {
    if (!groupID) {
      state.onlineMembers = getBackendOnlineMembers(room)
      state.onlineCount = getBackendOnlineCount(room) ?? state.onlineMembers.length
      state.memberCount = toNumber((room as Record<string, unknown>).memberCount) ?? 0
      return
    }

    const joined = await ensureJoinedGroup(groupID, state)
    if (!joined) {
      state.onlineMembers = getBackendOnlineMembers(room)
      state.onlineCount = getBackendOnlineCount(room) ?? state.onlineMembers.length
      state.memberCount = toNumber((room as Record<string, unknown>).memberCount) ?? 0
      return
    }

    try {
      const { data } = await IMSDK.getSpecifiedGroupsInfo([groupID])
      state.memberCount = data[0]?.memberCount ?? state.memberCount
    } catch (error) {
      console.warn('getSpecifiedGroupsInfo failed', error)
    }
    state.onlineMembers = getBackendOnlineMembers(room)
    state.onlineCount = getBackendOnlineCount(room) ?? state.onlineMembers.length
  } catch (error) {
    console.error('sync live room presence failed', error)
  } finally {
    state.loading = false
    syncingPresence.value = false
  }
}

const loadCurrentRoomOnlineMembers = async () => {
  const room = currentRoom.value
  if (!room || onlineMembersLoading.value) return

  const groupID = resolveRoomGroupID(room)
  const state = ensurePresenceState(room.id, groupID)
  state.groupID = groupID
  onlineMembersLoading.value = true

  try {
    if (!groupID) {
      state.onlineMembers = getBackendOnlineMembers(room)
      state.onlineCount = getBackendOnlineCount(room) ?? state.onlineMembers.length
      return
    }

    const joined = await ensureJoinedGroup(groupID, state)
    if (!joined) {
      state.onlineMembers = []
      state.onlineCount = getBackendOnlineCount(room) ?? 0
      return
    }

    const members = await getAllGroupMembers(groupID)
    state.members = members
    state.memberCount = Math.max(state.memberCount, members.length)

    await subscribeStatus(members.map((member) => member.userID))

    try {
      const { data } = await IMSDK.getSubscribeUsersStatus()
      applyUserStatus(data)
    } catch (error) {
      console.warn('getSubscribeUsersStatus failed', error)
    }

    const onlineMembers = members
      .filter((member) => userStatusMap[member.userID] === OnlineState.Online)
      .map((member) => ({
        userID: member.userID,
        nickname: member.nickname,
        faceURL: member.faceURL,
      }))
    state.onlineMembers = onlineMembers
    state.onlineCount = getBackendOnlineCount(room) ?? onlineMembers.length
  } catch (error) {
    console.error('load online members failed', error)
  } finally {
    onlineMembersLoading.value = false
  }
}

const openOnlineMembers = () => {
  onlineMembersVisible.value = true
}

const handleOnlineMembersClose = () => {
  void clearStatusSubscribe()
}

const loadRoomUrl = async (room: LiveRoomView) => {
  const expiresMs = (room.expiresAtUnix ?? 0) * 1000
  if (room.playHlsUrl && expiresMs - Date.now() > 30 * 1000) return
  if (room.urlLoading) return

  room.urlLoading = true
  try {
    const { data } = await getLiveRoomUrls({
      id: room.id,
      expireSeconds: expireSeconds.value,
    })
    Object.assign(room, data)
  } catch (error) {
    feedbackToast({
      message: 'Failed to load room stream',
      error,
    })
  } finally {
    room.urlLoading = false
  }
}

const clearPublicMessages = () => {
  pendingPublicMessages.length = 0
  if (publicMessageFlushTimer) {
    clearTimeout(publicMessageFlushTimer)
    publicMessageFlushTimer = undefined
  }
  liveMessages.value = []
  Object.keys(messageSeenMap).forEach((key) => {
    delete messageSeenMap[key]
  })
}

const scrollChatBottom = (force = false) => {
  if (chatAutoScrollRaf) {
    cancelAnimationFrame(chatAutoScrollRaf)
  }
  chatAutoScrollRaf = requestAnimationFrame(() => {
    chatAutoScrollRaf = 0
    if (!chatListRef.value) return
    const distanceToBottom =
      chatListRef.value.scrollHeight - chatListRef.value.scrollTop - chatListRef.value.clientHeight
    if (force || distanceToBottom <= 64) {
      chatListRef.value.scrollTop = chatListRef.value.scrollHeight
    }
  })
}

const getKeyboardInset = () => {
  const viewport = window.visualViewport
  if (!viewport) return 0
  const inset = window.innerHeight - viewport.height - viewport.offsetTop
  return inset > 0 ? Math.round(inset) : 0
}

const syncKeyboardInset = () => {
  keyboardInset.value = chatInputFocused.value ? getKeyboardInset() : 0
  scrollChatBottom(true)
}

const handleChatInputFocus = () => {
  chatInputFocused.value = true
  syncKeyboardInset()
  setTimeout(() => {
    syncKeyboardInset()
    window.scrollTo(0, 0)
  }, 80)
}

const handleChatInputBlur = () => {
  chatInputFocused.value = false
  keyboardInset.value = 0
}

const parsePublicMessage = (message: MessageItem): PublicMessage | undefined => {
  if (!message.clientMsgID) return undefined
  if (!currentRoomGroupID.value || message.groupID !== currentRoomGroupID.value) return undefined

  let text = ''
  if (message.contentType === MessageType.TextMessage) {
    text = message.textElem?.content ?? ''
  } else if (message.contentType === MessageType.AtTextMessage) {
    text = message.atTextElem?.text ?? ''
  } else {
    return undefined
  }
  if (!text.trim()) return undefined

  return {
    id: message.clientMsgID,
    userID: message.sendID,
    nickname: message.senderNickname || message.sendID,
    text,
    sendTime: message.sendTime ?? Date.now(),
  }
}

const flushPublicMessages = (forceScroll = false) => {
  if (publicMessageFlushTimer) {
    clearTimeout(publicMessageFlushTimer)
    publicMessageFlushTimer = undefined
  }
  if (pendingPublicMessages.length === 0) return

  const nextMessages = [...liveMessages.value]
  let changed = false
  for (const message of pendingPublicMessages.splice(0, pendingPublicMessages.length)) {
    if (messageSeenMap[message.id]) continue
    messageSeenMap[message.id] = true
    nextMessages.push(message)
    changed = true
  }
  if (!changed) return

  if (nextMessages.length > MAX_PUBLIC_MESSAGES) {
    nextMessages.splice(0, nextMessages.length - MAX_PUBLIC_MESSAGES)
  }
  liveMessages.value = nextMessages
  scrollChatBottom(forceScroll)
}

const scheduleFlushPublicMessages = (force = false) => {
  if (force) {
    flushPublicMessages(true)
    return
  }
  if (publicMessageFlushTimer) return
  publicMessageFlushTimer = setTimeout(() => {
    flushPublicMessages()
  }, PUBLIC_MESSAGE_FLUSH_MS)
}

const loadPublicMessages = async () => {
  clearPublicMessages()

  const groupID = currentRoomGroupID.value
  if (!groupID) return
  const joined = await ensureJoinedGroup(groupID, currentPresenceState.value)
  if (!joined) return

  try {
    const { data: conversationID } = await IMSDK.getConversationIDBySessionType({
      sourceID: groupID,
      sessionType: SessionType.WorkingGroup,
    })
    const { data } = await IMSDK.getAdvancedHistoryMessageListReverse({
      count: 30,
      viewType: ViewType.History,
      startClientMsgID: '',
      conversationID,
    })
    const messages = [...(data.messageList ?? [])].sort((a, b) => a.sendTime - b.sendTime)
    const parsedMessages: PublicMessage[] = []
    for (const message of messages) {
      const parsed = parsePublicMessage(message)
      if (parsed) {
        if (messageSeenMap[parsed.id]) continue
        messageSeenMap[parsed.id] = true
        parsedMessages.push(parsed)
      }
    }
    liveMessages.value = parsedMessages.slice(-MAX_PUBLIC_MESSAGES)
    scrollChatBottom(true)
  } catch (error) {
    console.warn('loadPublicMessages failed', error)
  }
}

const handleIncomingMessage = (message?: MessageItem, forceFlush = false) => {
  if (!message) return
  const parsed = parsePublicMessage(message)
  if (!parsed) return
  pendingPublicMessages.push(parsed)
  scheduleFlushPublicMessages(forceFlush)
}

const sendPublicMessage = async () => {
  const text = chatInput.value.trim()
  if (!text || !currentRoomGroupID.value || sendingMessage.value) return

  await ensureJoinedGroup(currentRoomGroupID.value, currentPresenceState.value)

  sendingMessage.value = true
  try {
    const { data: message } = await IMSDK.createTextMessage(text)
    const { data: sentMessage } = await IMSDK.sendMessage({
      recvID: '',
      groupID: currentRoomGroupID.value,
      message,
      isOnlineOnly: false,
    })
    chatInput.value = ''
    handleIncomingMessage(sentMessage, true)
  } catch (error) {
    const errCode = parseErrCode(error)
    feedbackToast({
      message:
        errCode === 1002
          ? '暂无发言权限，请确认已被拉入直播群且未被禁言'
          : errCode === 1004
            ? '直播群不存在，请联系管理员检查房间群配置'
            : errCode === 1507
              ? '登录态已失效，请重新登录后重试'
              : 'Send failed',
      error,
    })
  } finally {
    sendingMessage.value = false
  }
}

const enterCurrentRoom = async () => {
  const room = currentRoom.value
  if (!room) return
  await loadRoomUrl(room)
  await syncActiveRoomPresence()
  await loadPublicMessages()
}

const switchTo = (nextIndex: number) => {
  if (transitionLock.value) return
  if (nextIndex < 0 || nextIndex >= rooms.value.length) return
  if (nextIndex === activeIndex.value) return

  transitionLock.value = true
  activeIndex.value = nextIndex
  window.setTimeout(() => {
    transitionLock.value = false
  }, SWITCH_INTERVAL)
}

const switchByDelta = (delta: 1 | -1) => {
  switchTo(activeIndex.value + delta)
}

const handleWheel = (event: WheelEvent) => {
  if (Math.abs(event.deltaY) < WHEEL_TRIGGER) return
  switchByDelta(event.deltaY > 0 ? 1 : -1)
}

const handleTouchStart = (event: TouchEvent) => {
  startY.value = event.changedTouches?.[0]?.clientY ?? 0
}

const handleTouchEnd = (event: TouchEvent) => {
  const endY = event.changedTouches?.[0]?.clientY ?? 0
  const distance = endY - startY.value
  if (Math.abs(distance) < TOUCH_TRIGGER) return
  switchByDelta(distance > 0 ? -1 : 1)
}

const loadRooms = async () => {
  loading.value = true
  try {
    try {
      const { data } = await getLiveConfig()
      if (data.expireSeconds > 0) {
        expireSeconds.value = data.expireSeconds
      }
    } catch (error) {
      console.warn('getLiveConfig failed', error)
    }

    const { data } = await listLiveRooms({
      keyword: '',
      pagination: {
        pageNumber: 1,
        showNumber: 50,
      },
    })
    rooms.value = (data.list ?? []).map((room) => ({ ...room }))
    activeIndex.value = 0
  } catch (error) {
    feedbackToast({
      message: 'Failed to load live rooms',
      error,
    })
  } finally {
    loading.value = false
  }
}

const onUserStatusChanged = ({ data }: WSEvent<UserOnlineState>) => {
  if (!data?.userID) return
  userStatusMap[data.userID] = data.status
  const room = currentRoom.value
  if (room && onlineMembersVisible.value) {
    updateRoomOnlineState(room)
  }
}

const onRecvNewMessage = ({ data }: WSEvent<MessageItem>) => {
  handleIncomingMessage(data)
}

const onRecvNewMessages = ({ data }: WSEvent<MessageItem[]>) => {
  if (!Array.isArray(data)) return
  data.forEach((msg) => handleIncomingMessage(msg))
}

const scheduleRefreshPresence = () => {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
  }
  refreshTimer = setTimeout(() => {
    void syncActiveRoomPresence()
  }, 240)
}

const onGroupMemberChanged = ({ data }: WSEvent<GroupMemberItem>) => {
  if (!data?.groupID) return
  if (!onlineMembersVisible.value) return
  const room = currentRoom.value
  if (!room) return
  if (resolveRoomGroupID(room) !== data.groupID) return
  scheduleRefreshPresence()
}

watch(
  () => activeIndex.value,
  (nextIndex, prevIndex) => {
    const token = Date.now()
    roomChangeToken.value = token
    chatInput.value = ''
    onlineMembersVisible.value = false

    void (async () => {
      await clearStatusSubscribe()
      await leaveRoomPresence(getRoomByIndex(prevIndex))
      if (roomChangeToken.value !== token) return
      await enterCurrentRoom()
    })()
  },
)

onMounted(async () => {
  await loadRooms()
  await enterCurrentRoom()

  window.visualViewport?.addEventListener('resize', syncKeyboardInset)
  window.visualViewport?.addEventListener('scroll', syncKeyboardInset)
  window.addEventListener('orientationchange', syncKeyboardInset)
  window.addEventListener('resize', syncKeyboardInset)

  IMSDK.on(CbEvents.OnUserStatusChanged, onUserStatusChanged)
  IMSDK.on(CbEvents.OnGroupMemberAdded, onGroupMemberChanged)
  IMSDK.on(CbEvents.OnGroupMemberDeleted, onGroupMemberChanged)
  IMSDK.on(CbEvents.OnGroupMemberInfoChanged, onGroupMemberChanged)
  IMSDK.on(CbEvents.OnRecvNewMessage, onRecvNewMessage)
  IMSDK.on(CbEvents.OnRecvNewMessages, onRecvNewMessages)
})

onActivated(() => {
  roomChangeToken.value = Date.now()
  void enterCurrentRoom()
})

onDeactivated(() => {
  roomChangeToken.value = Date.now()
  chatInputFocused.value = false
  keyboardInset.value = 0
  void (async () => {
    await leaveRoomPresence(currentRoom.value)
    await clearStatusSubscribe()
  })()
})

onUnmounted(() => {
  roomChangeToken.value = Date.now()
  onlineMembersVisible.value = false
  window.visualViewport?.removeEventListener('resize', syncKeyboardInset)
  window.visualViewport?.removeEventListener('scroll', syncKeyboardInset)
  window.removeEventListener('orientationchange', syncKeyboardInset)
  window.removeEventListener('resize', syncKeyboardInset)
  IMSDK.off(CbEvents.OnUserStatusChanged, onUserStatusChanged)
  IMSDK.off(CbEvents.OnGroupMemberAdded, onGroupMemberChanged)
  IMSDK.off(CbEvents.OnGroupMemberDeleted, onGroupMemberChanged)
  IMSDK.off(CbEvents.OnGroupMemberInfoChanged, onGroupMemberChanged)
  IMSDK.off(CbEvents.OnRecvNewMessage, onRecvNewMessage)
  IMSDK.off(CbEvents.OnRecvNewMessages, onRecvNewMessages)
  void (async () => {
    await leaveRoomPresence(currentRoom.value)
    await clearStatusSubscribe()
  })()
  if (refreshTimer) {
    clearTimeout(refreshTimer)
  }
  if (chatAutoScrollRaf) {
    cancelAnimationFrame(chatAutoScrollRaf)
  }
  if (publicMessageFlushTimer) {
    clearTimeout(publicMessageFlushTimer)
  }
})
</script>

<style lang="scss" scoped>
.live_page {
  height: 100%;
  background: #060b14;
}

.state_wrap {
  display: flex;
  height: 100%;
  width: 100%;
  align-items: center;
  justify-content: center;
  color: #9fa8b9;
}

.live_swiper {
  position: relative;
  height: 100%;
  overflow: hidden;
}

.live_track {
  height: 100%;
  transition: transform 280ms ease;
}

.live_room {
  position: relative;
  height: 100%;
  width: 100%;
}

.live_video {
  height: 100%;
  width: 100%;
  object-fit: cover;
  background: #000;
}

.live_placeholder {
  display: flex;
  height: 100%;
  width: 100%;
  align-items: center;
  justify-content: center;
  background:
    linear-gradient(180deg, rgb(7 13 23 / 76%) 0%, rgb(3 6 13 / 72%) 100%),
    url('@/assets/images/profile/bg.png') center / cover no-repeat;
}

.placeholder_text {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: #e5ebf6;
}

.live_overlay {
  pointer-events: none;
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  padding: 16px 14px calc(8px + env(safe-area-inset-bottom));
  color: #f8fbff;
  background: linear-gradient(180deg, rgb(0 0 0 / 45%) 0%, rgb(0 0 0 / 8%) 40%, rgb(0 0 0 / 62%) 100%);
}

.room_head {
  margin-top: 6px;
}

.room_title {
  font-size: 18px;
  font-weight: 600;
}

.room_subtitle {
  margin-top: 4px;
  max-width: 90%;
  font-size: 12px;
  color: rgb(232 239 250 / 82%);
}

.room_metrics {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  pointer-events: auto;
}

.metric_chip {
  border-radius: 999px;
  background: rgb(4 12 22 / 56%);
  padding: 5px 10px;
  font-size: 11px;
  color: #d8e6ff;
  backdrop-filter: blur(8px);
}

.metric_chip_btn {
  border: none;
  cursor: pointer;
}

.chat_panel {
  pointer-events: auto;
  margin-top: auto;
  border-radius: 10px;
  background: rgb(7 15 26 / 62%);
  padding: 8px;
  backdrop-filter: blur(8px);
  transition: margin-bottom 120ms ease-out;
}

.chat_list {
  max-height: 124px;
  overflow-y: auto;
  padding-right: 2px;
}

.chat_item {
  margin-bottom: 4px;
  font-size: 12px;
  line-height: 18px;
  color: #dbe7f8;
}

.chat_name {
  margin-right: 4px;
  color: #75c7ff;
}

.chat_text {
  color: #f5f9ff;
}

.chat_input_row {
  margin-top: 6px;
  display: flex;
  gap: 6px;
}

.chat_input {
  flex: 1;
  min-width: 0;
  border: 1px solid rgb(141 160 194 / 32%);
  border-radius: 8px;
  background: rgb(10 21 36 / 85%);
  color: #f4f8ff;
  padding: 7px 8px;
  font-size: 12px;
  outline: none;
}

.chat_input::placeholder {
  color: #90a0bf;
}

.chat_send {
  min-width: 64px;
  border: none;
  border-radius: 8px;
  background: #1f96ff;
  color: #fff;
  font-size: 12px;
}

.chat_send:disabled {
  opacity: 0.5;
}

.online_popup {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 14px;
  background: #fff;
}

.online_popup_head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 15px;
  font-weight: 600;
  color: #202635;
}

.online_popup_count {
  font-size: 12px;
  font-weight: 500;
  color: #5d6a82;
}

.online_popup_state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8e99b0;
  font-size: 13px;
}

.online_member_list {
  margin-top: 10px;
  flex: 1;
  overflow-y: auto;
}

.online_member_item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}

.online_member_name {
  min-width: 0;
  flex: 1;
  color: #273145;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

