import {
  NavigationGuardNext,
  RouteLocationNormalized,
  RouteRecordRaw,
} from 'vue-router'
import TabbarLayout from '@layout/index.vue'
import GlobalWrap from '@layout/GlobalWrap.vue'
import conversationRouters from './modules/conversation'
import contactRouters from './modules/contact'
import profileRouters from './modules/profile'
import loginRouters from './modules/login'
import { getIMToken, getIMUserID } from '@/utils/storage'

const loginCheck = (
  to: RouteLocationNormalized,
  from: RouteLocationNormalized,
  next: NavigationGuardNext,
) => {
  const IMToken = getIMToken()
  const IMUserID = getIMUserID()

  if (!IMToken || !IMUserID) {
    next('login')
    return
  }

  next()
}

const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    name: 'GlobalWrap',
    component: GlobalWrap,
    children: [
      {
        path: '/',
        name: 'TabbarLayout',
        redirect: 'conversation',
        component: TabbarLayout,
        beforeEnter: loginCheck,
        children: [
          {
            path: '/conversation',
            name: 'Conversation',
            component: () => import('@pages/conversation/index/index.vue'),
          },
          {
            path: '/live',
            name: 'Live',
            component: () => import('@pages/live/index/index.vue'),
          },
          {
            path: '/contact',
            name: 'Contact',
            component: () => import('@pages/contact/index/index.vue'),
          },
          {
            path: '/workbench',
            name: 'Workbench',
            component: () => import('@pages/workbench/index/index.vue'),
          },
          {
            path: '/profile',
            name: 'Profile',
            component: () => import('@pages/profile/index/index.vue'),
          },
        ],
      },
      {
        path: '/',
        name: 'Common',
        beforeEnter: loginCheck,
        children: [...conversationRouters, ...contactRouters, ...profileRouters],
      },
      ...loginRouters,
    ],
  },
]

export default routes
