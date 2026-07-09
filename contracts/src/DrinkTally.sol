// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DrinkTally — onchain identity, tally, and leaderboard for Merge Sip
/// @notice Players claim a unique username, serve finished games onchain
///         (paying their own gas), and compete on a top-10 leaderboard.
contract DrinkTally {
    uint256 public constant BOARD_SIZE = 10;

    /// @notice Global count of games served onchain by all players.
    uint256 public totalServed;

    /// @notice Personal best score per player.
    mapping(address => uint256) public bestScore;

    /// @notice Highest drink tier (0-9) the player has ever mixed.
    mapping(address => uint8) public bestTier;

    /// @notice Display name per player, shown on the leaderboard.
    mapping(address => string) public usernameOf;

    /// @notice Username uniqueness registry (keccak256 of the name).
    mapping(bytes32 => address) public nameOwner;

    /// @dev Top players by best score, descending. Length <= BOARD_SIZE.
    address[] private board;

    event UsernameClaimed(address indexed player, string username);
    event ScoreServed(
        address indexed player,
        uint256 score,
        uint8 tier,
        uint256 totalServed
    );

    /// @notice Claim (or change) your leaderboard username.
    /// @param name 3-16 chars, lowercase letters, digits, underscore.
    function claimUsername(string calldata name) external {
        bytes memory b = bytes(name);
        require(b.length >= 3 && b.length <= 16, "3-16 chars");
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            require(
                (c >= 0x30 && c <= 0x39) || // 0-9
                    (c >= 0x61 && c <= 0x7a) || // a-z
                    c == 0x5f, // _
                "a-z, 0-9, _ only"
            );
        }
        bytes32 key = keccak256(b);
        require(nameOwner[key] == address(0), "name taken");

        // release the previous name, if any
        bytes memory old = bytes(usernameOf[msg.sender]);
        if (old.length > 0) delete nameOwner[keccak256(old)];

        nameOwner[key] = msg.sender;
        usernameOf[msg.sender] = name;
        emit UsernameClaimed(msg.sender, name);
    }

    /// @notice Record a finished game (win or lose).
    /// @param score The final score of the run.
    /// @param tier  The highest drink tier reached this run (0-9).
    function serveScore(uint256 score, uint8 tier) external {
        require(tier <= 9, "bad tier");
        totalServed += 1;
        bool newBest;
        if (score > bestScore[msg.sender]) {
            bestScore[msg.sender] = score;
            newBest = true;
        }
        if (tier > bestTier[msg.sender]) {
            bestTier[msg.sender] = tier;
        }
        if (newBest) {
            _updateBoard(msg.sender);
        }
        emit ScoreServed(msg.sender, score, tier, totalServed);
    }

    /// @notice Top players with their scores, tiers, and usernames.
    function getLeaderboard()
        external
        view
        returns (
            address[] memory players,
            uint256[] memory scores,
            uint8[] memory tiers,
            string[] memory names
        )
    {
        uint256 n = board.length;
        players = new address[](n);
        scores = new uint256[](n);
        tiers = new uint8[](n);
        names = new string[](n);
        for (uint256 i; i < n; i++) {
            address p = board[i];
            players[i] = p;
            scores[i] = bestScore[p];
            tiers[i] = bestTier[p];
            names[i] = usernameOf[p];
        }
    }

    /// @dev Re-rank a player after a new personal best. O(BOARD_SIZE).
    function _updateBoard(address p) internal {
        uint256 n = board.length;

        // remove the player's old entry, if present
        for (uint256 i; i < n; i++) {
            if (board[i] == p) {
                for (uint256 j = i; j + 1 < n; j++) {
                    board[j] = board[j + 1];
                }
                board.pop();
                n--;
                break;
            }
        }

        // find the insert position (scores descending)
        uint256 s = bestScore[p];
        uint256 pos = n;
        for (uint256 i; i < n; i++) {
            if (s > bestScore[board[i]]) {
                pos = i;
                break;
            }
        }
        if (pos >= BOARD_SIZE) return;

        board.push(address(0));
        for (uint256 j = board.length - 1; j > pos; j--) {
            board[j] = board[j - 1];
        }
        board[pos] = p;
        if (board.length > BOARD_SIZE) {
            board.pop();
        }
    }
}
