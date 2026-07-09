// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title DrinkTally — onchain identity, leaderboard, badges & score-card
///        NFTs for Merge Sip
/// @notice Players claim a unique username, serve finished games onchain
///         (paying their own gas), earn milestone badges for first-time
///         high-tier mixes, compete on a top-10 leaderboard, and can mint
///         their score card as a fully-onchain SVG NFT.
contract DrinkTally is ERC721 {
    using Strings for uint256;

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

    /// @notice Milestone badges as a bitmask (bit N = first-ever tier-N mix,
    ///         tracked for tiers 5-9).
    mapping(address => uint256) public badges;

    /// @dev Top players by best score, descending. Length <= BOARD_SIZE.
    address[] private board;

    /// @dev Score-card snapshot per token.
    struct Card {
        uint128 score;
        uint8 tier;
        uint64 mintedAt;
        string playerName;
    }

    uint256 public nextCardId = 1;
    mapping(uint256 => Card) public cards;

    event UsernameClaimed(address indexed player, string username);
    event ScoreServed(
        address indexed player,
        uint256 score,
        uint8 tier,
        uint256 totalServed
    );
    event BadgeEarned(address indexed player, uint8 tier);
    event CardMinted(address indexed player, uint256 tokenId, uint256 score, uint8 tier);

    constructor() ERC721("Merge Sip Score Cards", "SIPCARD") {}

    // -------------------------------------------------------------- profile

    /// @notice Claim (or change) your leaderboard username.
    /// @param name 3-16 chars, lowercase letters, digits, underscore.
    function claimUsername(string calldata name) external {
        bytes memory b = bytes(name);
        require(b.length >= 3 && b.length <= 16, "3-16 chars");
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            require(
                (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x7a) || c == 0x5f,
                "a-z, 0-9, _ only"
            );
        }
        bytes32 key = keccak256(b);
        require(nameOwner[key] == address(0), "name taken");

        bytes memory old = bytes(usernameOf[msg.sender]);
        if (old.length > 0) delete nameOwner[keccak256(old)];

        nameOwner[key] = msg.sender;
        usernameOf[msg.sender] = name;
        emit UsernameClaimed(msg.sender, name);
    }

    // -------------------------------------------------------------- scoring

    /// @notice Record a finished game (win or lose). Awards first-time
    ///         milestone badges for tiers 5-9 reached in this run.
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
        // Award every unearned milestone badge from tier 5 up through `tier`
        // — reaching tier 8 means the player mixed 5, 6, 7 and 8 in this run.
        if (tier >= 5) {
            uint256 current = badges[msg.sender];
            for (uint8 t = 5; t <= tier; t++) {
                uint256 bit = 1 << t;
                if (current & bit == 0) {
                    current |= bit;
                    emit BadgeEarned(msg.sender, t);
                }
            }
            badges[msg.sender] = current;
        }
        if (newBest) {
            _updateBoard(msg.sender);
        }
        emit ScoreServed(msg.sender, score, tier, totalServed);
    }

    // -------------------------------------------------------- score-card NFT

    /// @notice Mint your current best as a score-card NFT (onchain SVG).
    function mintScoreCard() external returns (uint256 tokenId) {
        uint256 score = bestScore[msg.sender];
        require(score > 0, "serve a score first");
        tokenId = nextCardId++;
        cards[tokenId] = Card({
            score: uint128(score),
            tier: bestTier[msg.sender],
            mintedAt: uint64(block.timestamp),
            playerName: usernameOf[msg.sender]
        });
        _safeMint(msg.sender, tokenId);
        emit CardMinted(msg.sender, tokenId, score, bestTier[msg.sender]);
    }

    function tierName(uint8 tier) public pure returns (string memory) {
        string[10] memory names = [
            "Cola Pop",
            "Lemon Fizz",
            "Lime Cooler",
            "Pink Punch",
            "Orange Sunrise",
            "Blueberry Breeze",
            "Mojito Royale",
            "Berry Colada",
            "Sunset Slush",
            "Legendary Tiki"
        ];
        return names[tier];
    }

    function _tierColor(uint8 tier) internal pure returns (string memory) {
        string[10] memory colors = [
            "#7a4a2a",
            "#ffe66d",
            "#a8e05f",
            "#ff8fc7",
            "#ffb347",
            "#6d8dff",
            "#7fe3c0",
            "#c77dff",
            "#ff7e5f",
            "#ffd166"
        ];
        return colors[tier];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_exists(tokenId), "no such card");
        Card memory card = cards[tokenId];
        string memory who = bytes(card.playerName).length > 0
            ? string.concat("@", card.playerName)
            : "anonymous mixologist";

        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">',
            '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">',
            '<stop offset="0" stop-color="#8fd8f0"/><stop offset=".55" stop-color="#bfeaf7"/>',
            '<stop offset=".75" stop-color="#f7e2b0"/><stop offset="1" stop-color="#efd193"/>',
            "</linearGradient></defs>",
            '<rect width="600" height="600" fill="url(#s)"/>',
            '<circle cx="500" cy="90" r="60" fill="#fff0aa" opacity=".9"/>',
            '<rect x="40" y="60" width="520" height="480" rx="28" fill="#fff8ec" stroke="#c07d3e" stroke-width="8"/>',
            '<text x="300" y="140" font-family="Trebuchet MS,sans-serif" font-size="44" font-weight="bold" fill="#c0392b" text-anchor="middle">MERGE SIP</text>',
            '<text x="300" y="185" font-family="Trebuchet MS,sans-serif" font-size="26" fill="#8a6a3a" text-anchor="middle">',
            who,
            "</text>",
            '<circle cx="300" cy="290" r="70" fill="',
            _tierColor(card.tier),
            '" stroke="#fff" stroke-width="8"/>',
            '<text x="300" y="425" font-family="Trebuchet MS,sans-serif" font-size="64" font-weight="bold" fill="#5a3410" text-anchor="middle">',
            uint256(card.score).toString(),
            "</text>",
            '<text x="300" y="470" font-family="Trebuchet MS,sans-serif" font-size="26" fill="#6b4a22" text-anchor="middle">Best drink: ',
            tierName(card.tier),
            "</text>",
            '<text x="300" y="520" font-family="Trebuchet MS,sans-serif" font-size="20" fill="#8a6a3a" text-anchor="middle">Served on Base</text>',
            "</svg>"
        );

        string memory json = string.concat(
            '{"name":"Merge Sip Score Card #',
            tokenId.toString(),
            '","description":"A Merge Sip run served onchain: ',
            uint256(card.score).toString(),
            " points, best drink ",
            tierName(card.tier),
            '.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)),
            '","attributes":[{"trait_type":"Score","value":',
            uint256(card.score).toString(),
            '},{"trait_type":"Best Drink","value":"',
            tierName(card.tier),
            '"},{"trait_type":"Player","value":"',
            who,
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    // ---------------------------------------------------------- leaderboard

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
