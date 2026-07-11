/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppUser, VoiceRoom, Gift, AgentTransferLog, FolderNode } from '../types';

export const INITIAL_GIFT_BALANCE = 10; // Welcome Bonus

export const SIMULATED_USERS: AppUser[] = [];

export const GIFTS: Gift[] = [
  {
    id: 'g1',
    name: 'Arabic Coffee',
    arabicName: 'قهوة شيوخ',
    icon: '☕',
    cost: 1,
    xpReward: 10,
    isPremium: false,
  },
  {
    id: 'g2',
    name: 'Oud Incense',
    arabicName: 'بخور عود',
    icon: '🪵',
    cost: 5,
    xpReward: 60,
    isPremium: false,
  },
  {
    id: 'g3',
    name: 'Arabian Falcon',
    arabicName: 'صقر شاهين',
    icon: '🦅',
    cost: 20,
    xpReward: 250,
    isPremium: true,
  },
  {
    id: 'g4',
    name: 'Luxury Sports Car',
    arabicName: 'سيارة فاخرة',
    icon: '🏎️',
    cost: 100,
    xpReward: 1500,
    isPremium: true,
  },
  {
    id: 'g5',
    name: 'Golden Dagger',
    arabicName: 'خنجر ذهبي',
    icon: '🗡️',
    cost: 500,
    xpReward: 8000,
    isPremium: true,
  },
];

export const INITIAL_ROOMS: VoiceRoom[] = [];

export const INITIAL_TRANSACTIONS: AgentTransferLog[] = [];

// Helper calculations for levels
export const getXpForNextUserLevel = (level: number) => {
  return level * 150 + 100;
};

export const getXpForNextRoomLevel = (level: number) => {
  return level * 300 + 200;
};

// Clean Architecture Flutter Directory Structure Blueprint
export const FLUTTER_FOLDER_STRUCTURE: FolderNode = {
  name: 'arab_voice_chat_app',
  type: 'folder',
  path: '',
  children: [
    {
      name: 'pubspec.yaml',
      type: 'file',
      path: 'pubspec.yaml',
      contentKey: 'pubspec'
    },
    {
      name: 'lib',
      type: 'folder',
      path: 'lib',
      children: [
        {
          name: 'main.dart',
          type: 'file',
          path: 'lib/main.dart',
          contentKey: 'main'
        },
        {
          name: 'core',
          type: 'folder',
          path: 'lib/core',
          children: [
            {
              name: 'theme',
              type: 'folder',
              path: 'lib/core/theme',
              children: [
                {
                  name: 'app_theme.dart',
                  type: 'file',
                  path: 'lib/core/theme/app_theme.dart',
                  contentKey: 'app_theme'
                }
              ]
            },
            {
              name: 'constants',
              type: 'folder',
              path: 'lib/core/constants',
              children: [
                {
                  name: 'constants.dart',
                  type: 'file',
                  path: 'lib/core/constants/constants.dart',
                  contentKey: 'constants'
                }
              ]
            },
            {
              name: 'services',
              type: 'folder',
              path: 'lib/core/services',
              children: [
                {
                  name: 'webrtc_service.dart',
                  type: 'file',
                  path: 'lib/core/services/webrtc_service.dart',
                  contentKey: 'webrtc_service'
                },
                {
                  name: 'economy_service.dart',
                  type: 'file',
                  path: 'lib/core/services/economy_service.dart',
                  contentKey: 'economy_service'
                }
              ]
            }
          ]
        },
        {
          name: 'features',
          type: 'folder',
          path: 'lib/features',
          children: [
            {
              name: 'auth',
              type: 'folder',
              path: 'lib/features/auth',
              children: [
                {
                  name: 'data',
                  type: 'folder',
                  path: 'lib/features/auth/data'
                },
                {
                  name: 'domain',
                  type: 'folder',
                  path: 'lib/features/auth/domain'
                },
                {
                  name: 'presentation',
                  type: 'folder',
                  path: 'lib/features/auth/presentation',
                  children: [
                    {
                      name: 'login_screen.dart',
                      type: 'file',
                      path: 'lib/features/auth/presentation/login_screen.dart',
                      contentKey: 'login_screen'
                    }
                  ]
                }
              ]
            },
            {
              name: 'voice_room',
              type: 'folder',
              path: 'lib/features/voice_room',
              children: [
                {
                  name: 'bloc',
                  type: 'folder',
                  path: 'lib/features/voice_room/bloc',
                  children: [
                    {
                      name: 'seat_management_bloc.dart',
                      type: 'file',
                      path: 'lib/features/voice_room/bloc/seat_management_bloc.dart',
                      contentKey: 'seat_management_bloc'
                    }
                  ]
                },
                {
                  name: 'models',
                  type: 'folder',
                  path: 'lib/features/voice_room/models',
                  children: [
                    {
                      name: 'room_model.dart',
                      type: 'file',
                      path: 'lib/features/voice_room/models/room_model.dart',
                      contentKey: 'room_model'
                    }
                  ]
                },
                {
                  name: 'presentation',
                  type: 'folder',
                  path: 'lib/features/voice_room/presentation',
                  children: [
                    {
                      name: 'room_view_widget.dart',
                      type: 'file',
                      path: 'lib/features/voice_room/presentation/room_view_widget.dart',
                      contentKey: 'room_view_widget'
                    }
                  ]
                }
              ]
            },
            {
              name: 'agent_dashboard',
              type: 'folder',
              path: 'lib/features/agent_dashboard',
              children: [
                {
                  name: 'presentation',
                  type: 'folder',
                  path: 'lib/features/agent_dashboard/presentation',
                  children: [
                    {
                      name: 'agent_dashboard_widget.dart',
                      type: 'file',
                      path: 'lib/features/agent_dashboard/presentation/agent_dashboard_widget.dart',
                      contentKey: 'agent_dashboard_widget'
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
};
