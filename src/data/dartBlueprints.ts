/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const DART_BLUEPRINTS: Record<string, string> = {
  pubspec: `name: arab_voice_chat_app
description: A luxury mobile group voice chat and entertainment application designed for the Arab market.
version: 1.0.0+1

environment:
  sdk: ">=3.0.0 <4.0.0"

dependencies:
  flutter:
    sdk: flutter
  flutter_localizations:
    sdk: flutter
  
  # State Management & Architecture
  flutter_bloc: ^8.1.3
  equatable: ^2.0.5
  get_it: ^7.6.0
  
  # UI & Icons
  google_fonts: ^6.1.0
  lucide_icons: ^0.320.0
  flutter_spinkit: ^5.2.0
  animate_do: ^3.1.2
  
  # WebRTC & Communication
  # zego_express_engine: ^4.0.0
  
  # Authentication & Cloud (Stubs included in architecture)
  google_sign_in: ^6.1.5
  sign_in_with_apple: ^5.0.0
  firebase_auth: ^4.15.3
  firebase_core: ^2.24.2

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^3.0.0

flutter:
  uses-material-design: true
  assets:
    - assets/images/
    - assets/sounds/
  fonts:
    - family: Cairo
      fonts:
        - asset: assets/fonts/Cairo-Regular.ttf
        - asset: assets/fonts/Cairo-Bold.ttf
          weight: 700`,

  main: `import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'core/theme/app_theme.dart';
import 'features/voice_room/bloc/seat_management_bloc.dart';
import 'features/voice_room/presentation/room_view_widget.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Initialize Firebase, Localizations, and WebRTC configurations here.
  
  runApp(const SadaAlArabApp());
}

class SadaAlArabApp extends StatelessWidget {
  const SadaAlArabApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return MultiBlocProvider(
      providers: [
        BlocProvider<SeatManagementBloc>(
          create: (context) => SeatManagementBloc()..add(const InitializeRoomEvent()),
        ),
      ],
      child: MaterialApp(
        title: 'صدى العرب | Sada Al-Arab',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.luxuryDarkTheme,
        locale: const Locale('ar', 'AE'), // Primary Arabic Language Focus
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: const [
          Locale('ar', 'AE'), // Arabic
          Locale('en', 'US'), // Optional English support
        ],
        home: const RoomListScreen(),
      ),
    );
  }
}

class RoomListScreen extends StatelessWidget {
  const RoomListScreen({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('استكشاف الغرف صوتية', style: TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.bold)),
        centerTitle: true,
      ),
      body: Center(
        child: ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: AppTheme.primaryPurple,
            padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
          ),
          onPressed: () {
            Navigator.push(
              context,
              MaterialPageRoute(builder: (context) => const VoiceRoomScreen(roomId: 'room_1')),
            );
          },
          child: const Text('دخول مجلس ديوانية العرب', style: TextStyle(fontFamily: 'Cairo', fontSize: 18, color: Colors.white)),
        ),
      ),
    );
  }
}`,

  app_theme: `import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class AppTheme {
  // Luxury Dark Mode Color Palette
  static const Color backgroundBlack = Color(0xFF03000A);
  static const Color cardDarkPurple = Color(0xFF120C24);
  static const Color primaryPurple = Color(0xFF7C3AED); // Luxury Violet
  static const Color secondaryMagenta = Color(0xFFC026D3); // Hot Pink Accent
  static const Color deepCyan = Color(0xFF0D9488);
  static const Color goldAccent = Color(0xFFFBBF24); // VIP Gold
  static const Color textWhite = Color(0xFFF3F4F6);
  static const Color textMuted = Color(0xFF9CA3AF);

  static ThemeData get luxuryDarkTheme {
    return ThemeData(
      brightness: Brightness.dark,
      primaryColor: primaryPurple,
      scaffoldBackgroundColor: backgroundBlack,
      cardColor: cardDarkPurple,
      fontFamily: 'Cairo', // Custom luxury font for Arab users
      textTheme: const TextTheme(
        displayLarge: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: textWhite, fontFamily: 'Cairo'),
        titleLarge: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: textWhite, fontFamily: 'Cairo'),
        bodyLarge: TextStyle(fontSize: 16, color: textWhite, fontFamily: 'Cairo'),
        bodyMedium: TextStyle(fontSize: 14, color: textMuted, fontFamily: 'Cairo'),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: backgroundBlack,
        elevation: 0,
        iconTheme: IconThemeData(color: textWhite),
        titleTextStyle: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: textWhite, fontFamily: 'Cairo'),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primaryPurple,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 24),
        ),
      ),
    );
  }
}`,

  constants: `class AppConstants {
  static const int totalSeats = 9;
  static const int hostSeatIndex = 0;
  static const int guestSeatsCount = 8;
  
  // Simulated Agent Configuration
  static const String agentPin = "9999";
  static const double welcomeBonusCoins = 10.0;
  
  // Level Formula Settings
  static const int xpPerHourInRoom = 50;
  static const int xpPerCoinSpent = 10;
}`,

  webrtc_service: `import 'dart:async';

/// Mobile-ONLY Abstract WebRTC Bridge Interface.
/// Designed specifically for ZegoCloud Mobile Voice SDKs.
abstract class WebRtcVoiceService {
  Future<void> initializeSdk({required String appId});
  Future<void> joinVoiceRoom({required String roomId, required String token, required int uid});
  Future<void> leaveVoiceRoom();
  Future<void> muteLocalAudio(bool isMuted);
  Future<void> muteRemoteAudio(int uid, bool isMuted);
  Stream<List<int>> get activeSpeakersStream;
}
`,

  economy_service: `import 'dart:async';

class CoinTransaction {
  final String transactionId;
  final String senderId;
  final String receiverId;
  final double amount;
  final DateTime timestamp;

  CoinTransaction({
    required this.transactionId,
    required this.senderId,
    required this.receiverId,
    required this.amount,
    required this.timestamp,
  });
}

/// Secure Closed Economy & Authorized Agent Service.
/// This model acts as the authority managing off-chain instant coin transfers
/// and credit systems before Apple/Google dynamic gateway integration.
class EconomyService {
  static final EconomyService _instance = EconomyService._internal();
  factory EconomyService() => _instance;
  EconomyService._internal();

  double _agentBalance = 250000.0;
  final List<CoinTransaction> _transactionHistory = [];

  double get agentBalance => _agentBalance;
  List<CoinTransaction> get transactionLogs => List.unmodifiable(_transactionHistory);

  Future<bool> transferCoins({
    required String senderAgentId,
    required String targetUserId,
    required double amount,
    required String verificationPin,
  }) async {
    // Check validation PIN
    if (verificationPin != "9999") {
      return false;
    }
    
    if (_agentBalance < amount) {
      return false; // Insufficient Balance
    }

    // Simulate Network Latency on Mobile
    await Future.delayed(const Duration(milliseconds: 600));

    _agentBalance -= amount;
    _transactionHistory.insert(
      0,
      CoinTransaction(
        transactionId: "TX_\${DateTime.now().millisecondsSinceEpoch}",
        senderId: senderAgentId,
        receiverId: targetUserId,
        amount: amount,
        timestamp: DateTime.now(),
      ),
    );

    return true;
  }
}`,

  seat_management_bloc: `import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:equatable/equatable.dart';

// --- Events ---
abstract class SeatManagementEvent extends Equatable {
  const SeatManagementEvent();
  @override
  List<Object?> get props => [];
}

class InitializeRoomEvent extends SeatManagementEvent {
  const InitializeRoomEvent();
}

class ToggleSeatLockEvent extends SeatManagementEvent {
  final int seatIndex;
  const ToggleSeatLockEvent(this.seatIndex);
  @override
  List<Object?> get props => [seatIndex];
}

class ToggleSeatMuteEvent extends SeatManagementEvent {
  final int seatIndex;
  const ToggleSeatMuteEvent(this.seatIndex);
  @override
  List<Object?> get props => [seatIndex];
}

class AssignUserToSeatEvent extends SeatManagementEvent {
  final int seatIndex;
  final String userId;
  const AssignUserToSeatEvent(this.seatIndex, this.userId);
  @override
  List<Object?> get props => [seatIndex, userId];
}

class KickUserFromSeatEvent extends SeatManagementEvent {
  final int seatIndex;
  const KickUserFromSeatEvent(this.seatIndex);
  @override
  List<Object?> get props => [seatIndex];
}

// --- State ---
class SeatState extends Equatable {
  final int index;
  final String? userId;
  final bool isMuted;
  final bool isLocked;

  const SeatState({
    required this.index,
    this.userId,
    this.isMuted = false,
    this.isLocked = false,
  });

  SeatState copyWith({
    String? userId,
    bool? isMuted,
    bool? isLocked,
    bool clearUser = false,
  }) {
    return SeatState(
      index: index,
      userId: clearUser ? null : (userId ?? this.userId),
      isMuted: isMuted ?? this.isMuted,
      isLocked: isLocked ?? this.isLocked,
    );
  }

  @override
  List<Object?> get props => [index, userId, isMuted, isLocked];
}

class VoiceRoomState extends Equatable {
  final List<SeatState> seats;
  final String hostUserId;

  const VoiceRoomState({
    required this.seats,
    required this.hostUserId,
  });

  @override
  List<Object?> get props => [seats, hostUserId];
}

// --- Bloc Implementation ---
class SeatManagementBloc extends Bloc<SeatManagementEvent, VoiceRoomState> {
  SeatManagementBloc()
      : super(VoiceRoomState(
          hostUserId: '1001',
          seats: List.generate(
            9,
            (index) => SeatState(index: index, userId: index == 0 ? '1001' : null),
          ),
        )) {
    on<InitializeRoomEvent>((event, emit) {
      // Set initial seats
      emit(VoiceRoomState(
        hostUserId: '1001',
        seats: List.generate(
          9,
          (index) => SeatState(index: index, userId: index == 0 ? '1001' : null),
        ),
      ));
    });

    on<ToggleSeatLockEvent>((event, emit) {
      final updatedSeats = state.seats.map((seat) {
        if (seat.index == event.seatIndex) {
          return seat.copyWith(isLocked: !seat.isLocked, clearUser: !seat.isLocked);
        }
        return seat;
      }).toList();
      emit(VoiceRoomState(seats: updatedSeats, hostUserId: state.hostUserId));
    });

    on<ToggleSeatMuteEvent>((event, emit) {
      final updatedSeats = state.seats.map((seat) {
        if (seat.index == event.seatIndex) {
          return seat.copyWith(isMuted: !seat.isMuted);
        }
        return seat;
      }).toList();
      emit(VoiceRoomState(seats: updatedSeats, hostUserId: state.hostUserId));
    });

    on<AssignUserToSeatEvent>((event, emit) {
      final updatedSeats = state.seats.map((seat) {
        if (seat.index == event.seatIndex && !seat.isLocked) {
          return seat.copyWith(userId: event.userId);
        }
        return seat;
      }).toList();
      emit(VoiceRoomState(seats: updatedSeats, hostUserId: state.hostUserId));
    });

    on<KickUserFromSeatEvent>((event, emit) {
      final updatedSeats = state.seats.map((seat) {
        if (seat.index == event.seatIndex) {
          return seat.copyWith(clearUser: true);
        }
        return seat;
      }).toList();
      emit(VoiceRoomState(seats: updatedSeats, hostUserId: state.hostUserId));
    });
  }
}`,

  room_model: `class AppUser {
  final String id;
  final String name;
  final String avatarUrl;
  final int level;

  AppUser({
    required this.id,
    required this.name,
    required this.avatarUrl,
    required this.level,
  });
}

class VoiceRoomModel {
  final String roomId;
  final String title;
  final String description;
  final int level;
  final bool isPrivate;
  final String? passcode;
  final List<String?> seats; // 9 indexes matching the micro seats layout

  VoiceRoomModel({
    required this.roomId,
    required this.title,
    required this.description,
    required this.level,
    required this.isPrivate,
    this.passcode,
    required this.seats,
  });
}`,

  room_view_widget: `import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../bloc/seat_management_bloc.dart';
import '../../../../core/theme/app_theme.dart';

class VoiceRoomScreen extends StatelessWidget {
  final String roomId;
  const VoiceRoomScreen({Key? key, required this.roomId}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              AppTheme.backgroundBlack,
              Color(0xFF0F0B1E),
              Color(0xFF1E0E3B),
            ],
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              _buildHeader(context),
              const SizedBox(height: 20),
              Expanded(
                child: _buildSeatsGrid(context),
              ),
              _buildBottomActionBar(context),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 10.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Container(
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: AppTheme.goldAccent, width: 2),
                ),
                child: const CircleAvatar(
                  radius: 20,
                  backgroundImage: NetworkImage('https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=120'),
                ),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('مجلس ديوانية العرب ☕', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppTheme.goldAccent,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: const Text('مستوى الغرفة: ١٢', style: TextStyle(fontSize: 10, color: Colors.black, fontWeight: FontWeight.bold)),
                      ),
                    ],
                  )
                ],
              )
            ],
          ),
          IconButton(
            icon: const Icon(Icons.close, color: Colors.white),
            onPressed: () => Navigator.pop(context),
          )
        ],
      ),
    );
  }

  Widget _buildSeatsGrid(BuildContext context) {
    return BlocBuilder<SeatManagementBloc, VoiceRoomState>(
      builder: (context, state) {
        return Column(
          children: [
            // Host Seat at Top Center
            _buildSeatItem(context, state.seats[0], isHost: true),
            const SizedBox(height: 24),
            // Guest Seats in 4x2 Grid Layout
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24.0),
                child: GridView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 4,
                    mainAxisSpacing: 16,
                    crossAxisSpacing: 16,
                    childAspectRatio: 0.8,
                  ),
                  itemCount: 8,
                  itemBuilder: (context, idx) {
                    final seat = state.seats[idx + 1]; // Offset index for guest seats
                    return _buildSeatItem(context, seat, isHost: false);
                  },
                ),
              ),
            )
          ],
        );
      },
    );
  }

  Widget _buildSeatItem(BuildContext context, SeatState seat, {required bool isHost}) {
    return GestureDetector(
      onTap: () {
        _showSeatActionsDialog(context, seat);
      },
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Stack(
            alignment: Alignment.center,
            children: [
              // Golden Halo or Glow for Host
              Container(
                width: isHost ? 80 : 54,
                height: isHost ? 80 : 54,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: isHost ? AppTheme.goldAccent : (seat.isLocked ? Colors.red : AppTheme.primaryPurple),
                    width: 2,
                  ),
                ),
                child: CircleAvatar(
                  backgroundColor: AppTheme.cardDarkPurple,
                  child: seat.userId != null
                      ? const Icon(Icons.person, color: Colors.white)
                      : (seat.isLocked
                          ? const Icon(Icons.lock, size: 16, color: Colors.red)
                          : const Icon(Icons.mic_none, size: 18, color: Colors.white54)),
                ),
              ),
              if (seat.isMuted)
                Positioned(
                  bottom: 0,
                  right: 0,
                  child: Container(
                    padding: const EdgeInsets.all(2),
                    decoration: const BoxDecoration(color: Colors.red, shape: BoxShape.circle),
                    child: const Icon(Icons.mic_off, size: 12, color: Colors.white),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            seat.userId != null ? 'المقعد \${seat.index}' : (seat.isLocked ? 'مغلق' : 'متاح'),
            style: TextStyle(
              fontSize: 12,
              color: seat.isLocked ? Colors.red : AppTheme.textWhite,
              fontFamily: 'Cairo',
            ),
          )
        ],
      ),
    );
  }

  void _showSeatActionsDialog(BuildContext context, SeatState seat) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.cardDarkPurple,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.only(topLeft: Radius.circular(16), topRight: Radius.circular(16))),
      builder: (ctx) {
        return Directionality(
          textDirection: TextDirection.rtl,
          child: Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('إدارة المقعد رقم \${seat.index}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                const SizedBox(height: 16),
                ListTile(
                  leading: Icon(seat.isMuted ? Icons.mic : Icons.mic_off, color: Colors.white),
                  title: Text(seat.isMuted ? 'إلغاء كتم الصوت' : 'كتم الصوت المقعد'),
                  onTap: () {
                    context.read<SeatManagementBloc>().add(ToggleSeatMuteEvent(seat.index));
                    Navigator.pop(ctx);
                  },
                ),
                ListTile(
                  leading: Icon(seat.isLocked ? Icons.lock_open : Icons.lock, color: Colors.white),
                  title: Text(seat.isLocked ? 'إلغاء قفل المقعد' : 'قفل المقعد'),
                  onTap: () {
                    context.read<SeatManagementBloc>().add(ToggleSeatLockEvent(seat.index));
                    Navigator.pop(ctx);
                  },
                ),
                if (seat.userId != null)
                  ListTile(
                    leading: const Icon(Icons.gavel, color: Colors.red),
                    title: const Text('طرد العضو من المقعد', style: TextStyle(color: Colors.red)),
                    onTap: () {
                      context.read<SeatManagementBloc>().add(KickUserFromSeatEvent(seat.index));
                      Navigator.pop(ctx);
                    },
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildBottomActionBar(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      color: AppTheme.backgroundBlack,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          IconButton(
            icon: const Icon(Icons.mic, color: Colors.white),
            onPressed: () {},
          ),
          IconButton(
            icon: const Icon(Icons.card_giftcard, color: AppTheme.secondaryMagenta),
            onPressed: () {},
          ),
          IconButton(
            icon: const Icon(Icons.security, color: AppTheme.goldAccent),
            onPressed: () {},
          ),
        ],
      ),
    );
  }
}`,

  agent_dashboard_widget: `import 'package:flutter/material.dart';
import '../../../../core/services/economy_service.dart';
import '../../../../core/theme/app_theme.dart';

class AgentDashboardWidget extends StatefulWidget {
  const AgentDashboardWidget({Key? key}) : super(key: key);

  @override
  State<AgentDashboardWidget> createState() => _AgentDashboardWidgetState();
}

class _AgentDashboardWidgetState extends State<AgentDashboardWidget> {
  final TextEditingController _userIdController = TextEditingController();
  final TextEditingController _amountController = TextEditingController();
  final TextEditingController _pinController = TextEditingController();
  
  final EconomyService _economyService = EconomyService();
  bool _isTransferring = false;
  String? _foundUserName;

  void _searchUser(String userId) {
    // Simulated dynamic user fetching for verification
    setState(() {
      if (userId == "1001") {
        _foundUserName = "أحمد العتيبي";
      } else if (userId == "1002") {
        _foundUserName = "سارة القحطاني";
      } else if (userId == "1004") {
        _foundUserName = "خالد الحربي";
      } else {
        _foundUserName = null;
      }
    });
  }

  void _executeTransfer() async {
    if (_foundUserName == null || _amountController.text.isEmpty || _pinController.text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('الرجاء تعبئة البيانات والتحقق من رقم معرف المستخدم')),
      );
      return;
    }

    setState(() => _isTransferring = true);
    
    final success = await _economyService.transferCoins(
      senderAgentId: 'AGENT_9999',
      targetUserId: _userIdController.text,
      amount: double.parse(_amountController.text),
      verificationPin: _pinController.text,
    );

    setState(() => _isTransferring = false);

    if (success) {
      _amountController.clear();
      _pinController.clear();
      _userIdController.clear();
      _foundUserName = null;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تحويل الكوينزات بنجاح وإرسال الفاتورة للعميل')),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('فشل التحويل. تحقق من الرصيد أو رمز الأمان الخاص بك')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('لوحة تحكم الوكيل المعتمد 🛡️'),
          centerTitle: true,
        ),
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Agent balance Card
              _buildBalanceCard(),
              const SizedBox(height: 24),
              // Search User Bar
              const Text('البحث عن معرف المستلم (ID)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(height: 8),
              TextField(
                controller: _userIdController,
                decoration: InputDecoration(
                  hintText: 'مثال: 1001',
                  prefixIcon: const Icon(Icons.search),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                  suffixIcon: ElevatedButton(
                    onPressed: () => _searchUser(_userIdController.text),
                    style: ElevatedButton.styleFrom(backgroundColor: AppTheme.primaryPurple),
                    child: const Text('تحقق'),
                  ),
                ),
                keyboardType: TextInputType.number,
              ),
              if (_foundUserName != null) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: Colors.green.withOpacity(0.15), borderRadius: BorderRadius.circular(8)),
                  child: Row(
                    children: [
                      const Icon(Icons.verified, color: Colors.green),
                      const SizedBox(width: 8),
                      Text('تم العثور على: \$_foundUserName', style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.green)),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 20),
              // Transfer inputs
              const Text('مبلغ الشحن والتحويل', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(height: 8),
              TextField(
                controller: _amountController,
                decoration: InputDecoration(hintText: 'أدخل عدد الكوينزات المشتراة', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12))),
                keyboardType: TextInputType.number,
              ),
              const SizedBox(height: 16),
              const Text('رمز تأكيد الوكيل PIN', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(height: 8),
              TextField(
                controller: _pinController,
                decoration: InputDecoration(hintText: 'أدخل PIN الخاص بك لتوثيق العملية', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12))),
                obscureText: true,
                keyboardType: TextInputType.number,
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _isTransferring ? null : _executeTransfer,
                  style: ElevatedButton.styleFrom(backgroundColor: AppTheme.goldAccent, foregroundColor: Colors.black),
                  child: _isTransferring
                      ? const CircularProgressIndicator()
                      : const Text('إتمام عملية التحويل الفوري', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                ),
              )
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBalanceCard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: const LinearGradient(colors: [AppTheme.primaryPurple, AppTheme.secondaryMagenta]),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          const Text('رصيد كوينزات الوكالة الفوري', style: TextStyle(fontSize: 16, color: Colors.white70)),
          const SizedBox(height: 8),
          Text(
            '\${_economyService.agentBalance.toStringAsFixed(0)} 🪙',
            style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: Colors.white),
          ),
        ],
      ),
    );
  }
}`,
};
